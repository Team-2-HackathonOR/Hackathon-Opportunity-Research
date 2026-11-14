import { db, HttpError, json, readJson } from "./runtime.ts";
import { latestJob, type Job } from "./pipeline.ts";
import { encryptKey } from "./pipeline-keys.ts";
import { verifyStagedCount } from "./staging-storage.ts";

export async function handleNextStep(request: Request): Promise<Response> {
  if (request.method !== "POST") throw new HttpError(405, "Advancing to ETL requires POST and explicit confirmation.");
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !("confirmation" in payload) || payload.confirmation !== "ADVANCE TO ETL" ||
      !("jobId" in payload) || typeof payload.jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.jobId) ||
      !("apiKey" in payload) || typeof payload.apiKey !== "string" || !payload.apiKey.trim() || payload.apiKey.length > 4096) {
    throw new HttpError(400, "Confirm advancement to ETL, choose the stopped run, and enter a fresh AI API key.");
  }
  const job = await latestJob();
  if (!job || job.id !== payload.jobId || job.status !== "failed" || job.cancelled !== true ||
      job.stagingBackend !== "supabase-storage" || job.purpose === "clear" || job.cursor.phase !== "scraper") {
    throw new HttpError(409, "Only the latest stopped scraper can advance. Refresh its status; no other stage was skipped.");
  }
  const count = await verifyStagedCount(job.startedAt);
  if (!Number.isSafeInteger(count) || count < 0) throw new HttpError(503, "The staged record count was not confirmed.");
  try {
    const [row] = await db()<{ job: Job }[]>`SELECT pipeline_control.advance_edge_job_to_etl(
      ${payload.jobId}::uuid,${encryptKey(payload.apiKey.trim(), payload.jobId)},${job.startedAt},${count}) AS job`;
    if (!row?.job) throw new HttpError(503, "Advancement to ETL was not queued. The stopped checkpoint was preserved.");
    return json({ job: row.job }, 202);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001") throw new HttpError(409, error.message);
    throw error;
  }
}
