import { FatalError } from "workflow";
import { getStore, PipelineStateError } from "../src/store.mjs";

class ServiceError extends Error {}

async function callService(id, operation, route, body, validate, extraHeaders = {}) {
  const store = getStore();
  try {
    return await store.operation(id, operation, async () => {
      const apiKey = await store.key(id);
      if (!process.env.AUTH_GATEWAY_URL || !process.env.GATEWAY_INTERNAL_SECRET) {
        throw new ServiceError("Worker AUTH_GATEWAY_URL and GATEWAY_INTERNAL_SECRET are required.");
      }
      const response = await fetch(new URL(route, process.env.AUTH_GATEWAY_URL), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-gateway-caller": "team-2-gateway",
          "x-gateway-secret": process.env.GATEWAY_INTERNAL_SECRET,
          "x-ai-api-key": apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(220000),
      });
      if (!response.ok) throw new ServiceError(`Operation ${operation} returned HTTP ${response.status}. Check service logs.`);
      const payload = await response.json();
      if (!validate(payload)) throw new ServiceError(`Operation ${operation} returned an invalid summary.`);
      return payload;
    });
  } catch (error) {
    // Never persist upstream bodies, connection details, or the per-run key.
    const message = error instanceof SyntaxError ? `Operation ${operation} returned invalid JSON.`
      : error instanceof TypeError || error.name === "TimeoutError"
        ? `Operation ${operation} could not complete; its outcome may be uncertain. Check service logs.`
        : error instanceof ServiceError || error instanceof PipelineStateError
          ? error.message : `Operation ${operation} could not persist its result. Check worker logs before retrying.`;
    await store.fail(id, message);
    throw new FatalError(message);
  }
}
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export async function resetDatabase(id, database) {
  "use step";
  const field = database === "mongodb" ? "deletedRecords" : "deletedEvents";
  const route = database === "mongodb" ? "/api/internal/scraper/hackathons/reset" : "/api/internal/hackathons/reset";
  const result = await callService(id, `reset-${database}`, route, {},
    (value) => value?.reset === true && count(value[field]));
  await getStore().update(id, (job) => { job.reset[database] = result[field]; });
}
resetDatabase.maxRetries = 0;

export async function scrapePage(id, page) {
  "use step";
  const store = getStore();
  const { job } = await store.row(id);
  const fetchedAt = job.startedAt;
  await store.update(id, (job) => {
    job.steps.reset.status = "completed";
    job.steps.reset.finishedAt ??= new Date().toISOString();
    job.stage = "scraper";
    job.steps.scraper.status = "running";
    job.steps.scraper.startedAt ??= job.steps.reset.finishedAt;
  });
  const result = await callService(id, `scrape-${page}`,
    `/api/internal/scraper/hackathons/persist-all?startPage=${page}&maxPages=1`, undefined,
    (value) => value?.persisted === true && value.fetchedAt === fetchedAt &&
      value.pagesPersisted === 1 && count(value.runUniqueHackathonsPersisted) &&
      Number.isSafeInteger(value.paginationAnalysis?.totalPages) && value.paginationAnalysis.totalPages >= page,
    { "x-pipeline-fetched-at": fetchedAt });
  await store.update(id, (job) => {
    job.scraper = { pagesPersisted: page, uniqueHackathonsPersisted: result.runUniqueHackathonsPersisted };
  });
  return { totalPages: result.paginationAnalysis.totalPages, expected: result.runUniqueHackathonsPersisted };
}
scrapePage.maxRetries = 0;

export async function importRecord(id, afterId, totals) {
  "use step";
  const store = getStore();
  const { job } = await store.row(id);
  await store.update(id, (job) => {
    job.steps.scraper.status = "completed";
    job.steps.scraper.finishedAt ??= new Date().toISOString();
    job.stage = "etl";
    job.steps.etl.status = "running";
    job.steps.etl.startedAt ??= job.steps.scraper.finishedAt;
  });
  const result = await callService(id, `etl-${afterId ?? "first"}`, "/api/internal/etl/etl/import/mongodb",
    { fetched_at: job.startedAt, limit: 1, use_ai_normalization: true, cursor_mode: true, after_id: afterId },
    (value) => count(value?.processed_count) && value.processed_count <= 1 &&
      count(value.inserted_count) && count(value.failed_count) &&
      value.inserted_count + value.failed_count === value.processed_count &&
      (value.processed_count === 0 || (Number.isSafeInteger(value.next_after_id) &&
        (afterId === null || value.next_after_id > afterId))));
  const next = {
    processed: totals.processed + result.processed_count,
    inserted: totals.inserted + result.inserted_count,
    failed: totals.failed + result.failed_count,
  };
  await store.update(id, (job) => { job.etl = next; });
  if (result.failed_count) {
    const message = "An ETL record failed. Successful inserts remain; inspect ETL logs before retrying.";
    await store.fail(id, message);
    throw new FatalError(message);
  }
  return { afterId: result.next_after_id, done: result.processed_count === 0, totals: next };
}
importRecord.maxRetries = 0;

export async function finishJob(id, error = null) {
  "use step";
  if (error) return getStore().fail(id, error);
  return getStore().update(id, (job) => {
    if (job.etl.processed !== job.scraper.uniqueHackathonsPersisted) {
      throw new Error("ETL count does not match the scraped run. Check MongoDB configuration.");
    }
    job.status = "completed";
    job.stage = "done";
    job.finishedAt = new Date().toISOString();
    job.steps.etl.status = "completed";
    job.steps.etl.finishedAt = job.finishedAt;
  });
}

export async function runPipeline(id) {
  "use workflow";
  try {
    await resetDatabase(id, "mongodb");
    await resetDatabase(id, "postgresql");
    let page = 1;
    while (true) {
      const result = await scrapePage(id, page);
      if (page >= result.totalPages) break;
      page += 1;
    }
    let afterId = null;
    let totals = { processed: 0, inserted: 0, failed: 0 };
    while (true) {
      const result = await importRecord(id, afterId, totals);
      totals = result.totals;
      if (result.done) break;
      afterId = result.afterId;
    }
    await finishJob(id);
  } catch {
    // The failing operation records its safe error before throwing.
    await finishJob(id, "Pipeline stopped. Inspect the failed stage and worker logs before starting another run.");
  }
}
