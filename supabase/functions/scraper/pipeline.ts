import { cancelJob,claimJob,createJob,expireJobs,failedJob,latestJob,nextOccurrence,operation,publishJob,rowKey,scheduleView } from "../_shared/pipeline.ts";
import { db,diagnosticError,env,HttpError,json,readJson } from "../_shared/runtime.ts";
import { handleScraper } from "./service.ts";
import { serviceJson } from "../_shared/service-errors.ts";
import { MAX_RUN_RECORDS } from "./scraper-io.ts";
import { advanceStorageReset,isResetAcknowledgement,resetOperationName,type ResetAcknowledgement } from "./reset-step.ts";
import { resumeJob } from "../_shared/pipeline-resume.ts";
import { finishClear } from "../_shared/pipeline-clear.ts";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
type PgReset = { reset: true; deletedEvents: number };
type Scrape = { persisted: true; fetchedAt: string; pagesPersisted: number; runUniqueHackathonsPersisted: number; paginationAnalysis: { totalPages: number } };
type Import = { processed_count: number; inserted_count: number; failed_count: number; next_after_id: number | null };

export async function tick(request: Request) {
  await expireJobs();
  let row = await claimJob();
  if (!row) {
    const key = Deno.env.get("AI_API_KEY")?.trim();
    const schedule = await scheduleView();
    if (schedule.frequency !== "off" && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= Date.now()) {
      if (!key) throw new HttpError(503, "AI_API_KEY is missing for the scheduled pipeline.");
      await createJob(key, true);
      row = await claimJob();
    }
  }
  if (!row) return json({ ok: true, active: false });
  const job = row.job;
  try {
    if (job.stagingBackend !== "supabase-storage") throw new HttpError(409, "This job predates Storage staging. Stop it and start a fresh run; old MongoDB operations must not be replayed against Storage.");
    if (job.purpose === "clear" && !job.cursor.phase.startsWith("reset-")) throw new HttpError(503, "Clear-only checkpoint is invalid; scraping and ETL were not started.");
    const key = job.purpose === "clear" ? "" : rowKey(row);
    job.status = "running";
    if (job.cursor.phase.startsWith("reset-")) {
      job.steps.reset.status = "running";
      job.steps.reset.startedAt ??= new Date().toISOString();
    }
    const timestamp = job.startedAt;
    const invokeScraper = async (path: string, method = "GET") => {
      const target = new URL(request.url);
      target.pathname = path.split("?")[0];
      target.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
      return await serviceJson(await handleScraper(new Request(target, {
        method, headers: {
          "x-gateway-secret": env("GATEWAY_INTERNAL_SECRET"), "x-gateway-caller": "team-2-gateway",
          "x-ai-api-key": key, "x-pipeline-fetched-at": timestamp,
        },
      }), target.pathname));
    };
    switch (job.cursor.phase) {
      case "reset-mongodb": {
        throw new HttpError(409, "This run uses retired MongoDB staging. Stop it and start a fresh Storage run; its old operation ledger must not be replayed against Storage.");
      }
      case "reset-storage": {
        const result = await operation<ResetAcknowledgement>(row, resetOperationName(job),
          () => invokeScraper("/hackathons/reset", "POST"),
          isResetAcknowledgement);
        advanceStorageReset(job, result);
        break;
      }
      case "reset-postgresql": {
        const result = await operation<PgReset>(row, "reset-postgresql", async () => await db().begin(async (sql) => {
          await sql`LOCK TABLE public.event_suggestions,hackathon_research.events IN EXCLUSIVE MODE`;
          await sql`UPDATE public.event_suggestions SET published_event_id=NULL WHERE published_event_id IS NOT NULL`;
          await sql`DELETE FROM hackathon_research.contribution_log WHERE event_id IS NOT NULL`;
          const removed = await sql`DELETE FROM hackathon_research.events`;
          return { reset: true as const, deletedEvents: removed.count };
        }), (v): v is PgReset => record(v) && v.reset === true && count(v.deletedEvents));
        job.reset.postgresql = result.deletedEvents;
        if (job.purpose === "clear") {
          await finishClear(row);
          return json({ ok: true, active: false, cleared: true });
        }
        job.steps.reset.status = "completed";
        job.steps.reset.finishedAt = new Date().toISOString();
        job.cursor.phase = "scraper";
        break;
      }
      case "scraper": {
        job.stage = "scraper";
        job.steps.scraper.status = "running";
        job.steps.scraper.startedAt ??= new Date().toISOString();
        const page = job.cursor.page;
        const result = await operation<Scrape>(row, `scrape-${page}`,
          () => invokeScraper(`/hackathons/persist-all?startPage=${page}&maxPages=1`),
          (v): v is Scrape => record(v) && v.persisted === true && v.fetchedAt === timestamp && v.pagesPersisted === 1 &&
            count(v.runUniqueHackathonsPersisted) && v.runUniqueHackathonsPersisted <= MAX_RUN_RECORDS && record(v.paginationAnalysis) &&
            count(v.paginationAnalysis.totalPages) && v.paginationAnalysis.totalPages >= page);
        job.scraper = { pagesPersisted: page, uniqueHackathonsPersisted: result.runUniqueHackathonsPersisted };
        if (page >= result.paginationAnalysis.totalPages || result.runUniqueHackathonsPersisted >= MAX_RUN_RECORDS) {
          job.steps.scraper.status = "completed"; job.steps.scraper.finishedAt = new Date().toISOString();
          job.cursor.phase = "etl";
        } else job.cursor.page++;
        break;
      }
      case "etl": {
        job.stage = "etl";
        job.steps.etl.status = "running";
        job.steps.etl.startedAt ??= new Date().toISOString();
        const afterId = job.cursor.afterId;
        const result = await operation<Import>(row, `etl-${afterId ?? "first"}`, async () => {
          const target = new URL("/api/internal/etl/etl/import/storage", env("AUTH_GATEWAY_URL"));
          if (target.protocol !== "https:" && Deno.env.get("ALLOW_LOCAL_GATEWAY") !== "true") throw new HttpError(503, "Pipeline gateway requires HTTPS.");
          return await serviceJson(await fetch(target, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(110000),
            headers: { "content-type": "application/json", "x-gateway-caller": "team-2-gateway",
              "x-gateway-secret": env("GATEWAY_INTERNAL_SECRET"), "x-ai-api-key": key },
            body: JSON.stringify({ fetched_at: timestamp, limit: 1, cursor_mode: true, after_id: afterId, use_ai_normalization: true }),
          }));
        }, (v): v is Import => record(v) && count(v.processed_count) && v.processed_count <= 1 &&
          count(v.inserted_count) && count(v.failed_count) && v.inserted_count + v.failed_count === v.processed_count &&
          (v.processed_count === 0 || count(v.next_after_id) && (afterId === null || v.next_after_id > afterId)));
        const totals = job.etl ?? { processed: 0, inserted: 0, failed: 0 };
        job.etl = { processed: totals.processed + result.processed_count, inserted: totals.inserted + result.inserted_count, failed: totals.failed + result.failed_count };
        if (result.failed_count) throw new HttpError(502, "An ETL record failed. Successful inserts remain; inspect logs before retrying.");
        if (result.processed_count === 0) {
          if (job.etl.processed !== job.scraper?.uniqueHackathonsPersisted) throw new HttpError(502, "ETL count does not match the scraped run. Inspect the Storage staging bucket and run timestamp.");
          job.status = "completed"; job.stage = "done"; job.finishedAt = new Date().toISOString();
          job.steps.etl.status = "completed"; job.steps.etl.finishedAt = job.finishedAt;
        } else job.cursor.afterId = result.next_after_id;
        break;
      }
      default: throw new HttpError(503, "Pipeline cursor is invalid.");
    }
    await publishJob(row, job);
  } catch (error) {
    console.error("Pipeline step failed.", { jobId: row.id, phase: job.cursor.phase, kind: error instanceof Error ? error.name : "unknown" });
    await publishJob(row, failedJob(job, diagnosticError(error)?.message ??
      "Pipeline operation could not complete; its outcome may be uncertain. Inspect logs before retrying."));
  }
  return json({ ok: true, active: true });
}

export async function handlePipeline(request: Request, path: string): Promise<Response> {
  if (request.method === "GET" && path === "/pipeline") return json({ job: await latestJob() });
  if (request.method === "POST" && path === "/pipeline/cancel") {
    const payload = await readJson(request);
    if (!record(payload) || typeof payload.jobId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.jobId)) {
      throw new HttpError(400, "Choose a valid pipeline run to stop.");
    }
    return json({ job: await cancelJob(payload.jobId) });
  }
  if (request.method === "POST" && ["/pipeline/run", "/pipeline/restart", "/pipeline/continue"].includes(path)) {
    const payload = await readJson(request);
    if (!record(payload) || typeof payload.apiKey !== "string" || !payload.apiKey.trim() || payload.apiKey.length > 4096) throw new HttpError(400, "Enter a valid AI API key.");
    const restarting = path === "/pipeline/restart";
    const continuing = path === "/pipeline/continue";
    if ((restarting || continuing) && (typeof payload.jobId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.jobId))) {
      throw new HttpError(400, `Choose a valid pipeline run to ${continuing ? "continue" : "reset"}.`);
    }
    const job = continuing ? await resumeJob(String(payload.jobId), payload.apiKey.trim())
      : await createJob(payload.apiKey.trim(), false, restarting ? String(payload.jobId) : undefined);
    if (!job) throw new HttpError(409, "No new pipeline run was queued. Refresh the pipeline status before trying again.");
    return json({ job }, 202);
  }
  if (request.method === "GET" && path === "/schedule") return json({ schedule: await scheduleView() });
  if (request.method === "POST" && path === "/schedule") {
    const payload = await readJson(request);
    if (!record(payload) || typeof payload.frequency !== "string" || !["off", "weekly", "biweekly", "monthly"].includes(payload.frequency)) throw new HttpError(400, "Choose a valid pipeline frequency.");
    if (payload.frequency !== "off" && !Deno.env.get("AI_API_KEY")?.trim()) throw new HttpError(400, "Configure AI_API_KEY before enabling automatic runs.");
    await db()`UPDATE pipeline_control.schedule SET value=${db().json({
      frequency: payload.frequency, nextRunAt: payload.frequency === "off" ? null : nextOccurrence(new Date(), payload.frequency),
    })} WHERE singleton=true`;
    return json({ schedule: await scheduleView() });
  }
  if (request.method === "POST" && path === "/pipeline/tick") return await tick(request);
  throw new HttpError(404, "Unknown pipeline route.");
}
