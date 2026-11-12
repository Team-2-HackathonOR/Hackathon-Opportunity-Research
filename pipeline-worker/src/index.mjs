import express from "express";
import { timingSafeEqual } from "node:crypto";
import { start, getRun } from "workflow/api";
import { runPipeline } from "../workflows/pipeline.mjs";
import { getStore } from "./store.mjs";
import scheduleHelpers from "../../hackscout-gateway/pipeline-schedule.js";

const { nextOccurrence } = scheduleHelpers;
const frequencies = ["off", "weekly", "biweekly", "monthly"];
function matches(value, expected) {
  return typeof value === "string" && typeof expected === "string" && expected.length >= 16 &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export async function dispatch(store, id, launch = start) {
  let runId;
  try {
    const run = await launch(runPipeline, [id], {
      experimental_hook: { token: `pipeline-${id}`, experimental_minRetention: "7d" },
    });
    runId = run.runId;
  } catch (error) {
    if (error.name !== "HookConflictError" || typeof error.conflictingRunId !== "string") throw error;
    runId = error.conflictingRunId;
  }
  await store.workflowId(id, runId);
}

export function createWorkerApp(storeFactory = getStore, launch = start) {
  const app = express();
  app.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    const authorized = request.path === "/cron"
      ? matches(request.get("authorization"), process.env.CRON_SECRET?.length >= 16 ? `Bearer ${process.env.CRON_SECRET}` : undefined)
      : request.get("x-gateway-caller") === "team-2-gateway" &&
        matches(request.get("x-gateway-secret"), process.env.GATEWAY_INTERNAL_SECRET);
    if (!authorized) return response.status(403).json({ error: "Trusted worker access is required." });
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  async function scheduleView(store) {
    const result = await store.pool.query("SELECT value FROM pipeline_control.schedule WHERE singleton=true");
    return { ...result.rows[0].value, timeZone: "Europe/Rome", time: "02:00", keyConfigured: !!process.env.AI_API_KEY?.trim(), lastError: null };
  }
  app.get("/pipeline", async (_request, response) => {
    response.json({ job: await storeFactory().latest() });
  });
  app.post("/pipeline/run", async (request, response) => {
    if (typeof request.body?.apiKey !== "string" || !request.body.apiKey.trim() || request.body.apiKey.length > 4096) {
      return response.status(400).json({ error: "Enter a valid AI API key." });
    }
    const store = storeFactory();
    const job = await store.create(request.body.apiKey.trim());
    if (!job) return response.status(409).json({ error: "A pipeline run is already active or blocked because a service operation has an uncertain outcome. Ask an operator to check worker logs." });
    await dispatch(store, job.id, launch);
    response.status(202).json({ job });
  });
  app.get("/schedule", async (_request, response) => {
    response.json({ schedule: await scheduleView(storeFactory()) });
  });
  app.post("/schedule", async (request, response) => {
    const frequency = request.body?.frequency;
    if (!frequencies.includes(frequency)) return response.status(400).json({ error: "Choose a valid pipeline frequency." });
    if (frequency !== "off" && !process.env.AI_API_KEY?.trim()) {
      return response.status(400).json({ error: "Configure AI_API_KEY on the workflow worker before enabling automatic runs." });
    }
    const store = storeFactory();
    const value = { frequency, nextRunAt: frequency === "off" ? null : nextOccurrence(new Date(), frequency) };
    await store.pool.query("UPDATE pipeline_control.schedule SET value=$1 WHERE singleton=true", [value]);
    response.json({ schedule: await scheduleView(store) });
  });
  app.get("/cron", async (_request, response) => {
    const store = storeFactory();
    await store.expire();
    // Recover enqueue acknowledgements lost to a restart, without launching a second workflow.
    const pending = await store.pool.query(
      "SELECT id,workflow_id FROM pipeline_control.jobs WHERE status IN ('queued','running')",
    );
    for (const row of pending.rows) {
      if (!row.workflow_id) await dispatch(store, row.id, launch);
      else {
        const status = await getRun(row.workflow_id).status;
        if (["failed", "cancelled", "completed"].includes(status)) {
          await store.fail(row.id, "Workflow stopped before publishing completion. Inspect worker logs before retrying.");
        }
      }
    }
    const due = await store.transaction(async (client) => {
      const { rows } = await client.query("SELECT value FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE");
      const schedule = rows[0].value;
      if (schedule.frequency === "off" || Date.parse(schedule.nextRunAt) > Date.now()) return null;
      if (!process.env.AI_API_KEY?.trim()) throw new Error("Worker AI_API_KEY is missing for the scheduled run.");
      const active = await client.query("SELECT id FROM pipeline_control.jobs WHERE status IN ('queued','running')");
      if (active.rows.length) return null;
      let nextRunAt = schedule.nextRunAt;
      do { nextRunAt = nextOccurrence(new Date(nextRunAt), schedule.frequency, true); } while (Date.parse(nextRunAt) <= Date.now());
      // Creating the job and advancing the schedule share one transaction.
      const job = await store.create(process.env.AI_API_KEY.trim(), client);
      if (!job) return null;
      await client.query("UPDATE pipeline_control.schedule SET value=$1 WHERE singleton=true",
        [{ ...schedule, nextRunAt, lastTriggeredAt: new Date().toISOString() }]);
      return job;
    });
    if (due) await dispatch(store, due.id, launch);
    response.json({ ok: true });
  });
  app.use((_request, response) => response.status(404).json({ error: "Unknown worker route." }));
  app.use((error, _request, response, _next) => {
    const status = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : 503;
    console.error("Workflow worker request failed.", { code: error.code || error.type || "internal" });
    response.status(status).json({ error: status === 503
      ? "The workflow worker could not complete this request. A queued job may still be recovered by cron; check worker logs before retrying."
      : "Enter a valid request of at most 8 KB." });
  });
  return app;
}

export default createWorkerApp();
