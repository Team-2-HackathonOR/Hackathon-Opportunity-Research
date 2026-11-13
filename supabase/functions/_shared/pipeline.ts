import { randomUUID } from "node:crypto";
import { db, HttpError } from "./runtime.ts";
import { executeOperation } from "./operation.ts";
import { encryptKey, decryptKey } from "./pipeline-keys.ts";
import { pipelineConflict, type Conflict } from "./pipeline-conflicts.ts";
export { encryptKey, decryptKey } from "./pipeline-keys.ts";

type Step = { status: string; startedAt?: string; finishedAt?: string };
export type Job = {
  id: string; status: string; stage: string; startedAt: string; finishedAt?: string; error?: string;
  cancelled?: boolean; executionState?: "waiting" | "executing";
  stagingBackend?: "supabase-storage"; purpose?: "clear";
  reset: Record<string, number>; steps: Record<string, Step>;
  scraper?: { pagesPersisted: number; uniqueHackathonsPersisted: number };
  etl?: { processed: number; inserted: number; failed: number };
  cursor: { phase: string; page: number; afterId: number | null; resetBatch?: number };
};
type Row = {
  id: string; status: string; job: Job; key_ciphertext: string | null; key_expires_at: Date;
  execution_id: string | null;
};
type Schedule = { frequency: string; nextRunAt: string | null; lastTriggeredAt?: string };

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const local = (date: Date) => Object.fromEntries(formatter.formatToParts(date)
  .filter((v) => ["year", "month", "day", "hour", "minute"].includes(v.type)).map((v) => [v.type, Number(v.value)]));
export function nextOccurrence(after: Date, frequency: string, recurring = false) {
  const parts = local(after);
  const midnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  const firstOffset = recurring ? frequency === "biweekly" ? 14 : 1 : 0;
  for (let offset = firstOffset; offset <= 62; offset++) {
    const day = new Date(midnight + offset * 86400000);
    if (frequency === "monthly" ? day.getUTCDate() !== 1 : day.getUTCDay() !== 0) continue;
    for (let minute = -180; minute <= 240; minute++) {
      const instant = new Date(day.getTime() + minute * 60000);
      const p = local(instant);
      if (p.year === day.getUTCFullYear() && p.month === day.getUTCMonth() + 1 &&
          p.day === day.getUTCDate() && p.hour >= 2) {
        if (instant > after) return instant.toISOString();
        break;
      }
    }
  }
  throw new Error("Could not calculate the next pipeline schedule.");
}

export async function scheduleView() {
  const [row] = await db()<{ value: Schedule }[]>`SELECT value FROM pipeline_control.schedule WHERE singleton=true`;
  if (!row) throw new HttpError(503, "Apply the pipeline control migration.");
  const [worker] = await db()<{ configured: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick' AND active
  ) AS configured`;
  return { ...row.value, workerConfigured: worker.configured, timeZone: "Europe/Rome", time: "02:00",
    keyConfigured: !!Deno.env.get("AI_API_KEY")?.trim(), lastError: null };
}
export async function latestJob() {
  const [row] = await db()<{ job: Job; status: string; executing: boolean }[]>`SELECT job,status,
    coalesce(execution_until>now(),false) AS executing FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1`;
  return row ? { ...row.job, status: row.status, executionState: row.executing ? "executing" : "waiting" } : null;
}
export async function cancelJob(id: string) {
  const [row] = await db()<{ job: Job | null }[]>`SELECT pipeline_control.cancel_edge_job(${id}::uuid) AS job`;
  if (!row?.job) throw new HttpError(409, "That Supabase pipeline run is no longer active. Refresh its status.");
  return row.job;
}

export async function createJob(key: string, scheduled = false, restartId?: string) {
  return await db().begin(async (sql) => {
    const [row] = await sql<{ value: Schedule }[]>`SELECT value FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE`;
    if (!row) throw new HttpError(503, "Apply the pipeline control migration.");
    if (scheduled && (row.value.frequency === "off" || !row.value.nextRunAt || Date.parse(row.value.nextRunAt) > Date.now())) return null;
    const [worker] = await sql<{ present: boolean; configured: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick'
    ) AS present, EXISTS (
      SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick' AND active
    ) AS configured`;
    if (!worker.configured) throw new HttpError(503, worker.present
      ? "Pipeline worker cron hackscout-edge-tick is paused. Re-enable the existing job only when ready for queued cleanup to execute."
      : "Pipeline worker cron hackscout-edge-tick does not exist. Configure Vault and register this cron job before starting a run.");
    const conflicts = await sql<Conflict[]>`SELECT j.id,j.status,j.executor,j.blocked_until>now() AS blocked,
      (SELECT name FROM pipeline_control.operations WHERE job_id=j.id AND status='started' ORDER BY name LIMIT 1) AS operation
      FROM pipeline_control.jobs j WHERE j.status IN ('queued','running') OR j.blocked_until>now() OR j.id=${restartId ?? null}::uuid
      ORDER BY j.created_at DESC`;
    const conflict = pipelineConflict(conflicts, restartId);
    if (conflict) { if (scheduled) return null; throw conflict; }
    if (restartId) {
      const [restart] = await sql<{ ready: boolean }[]>`SELECT pipeline_control.prepare_edge_restart(${restartId}::uuid) AS ready`;
      if (!restart.ready) throw new HttpError(409, "The pipeline state changed while preparing the restart. Refresh its status and review the current run before retrying.");
    }
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const job: Job = { id, status: "queued", stage: "reset", reset: {}, startedAt, stagingBackend: "supabase-storage",
      steps: { reset: { status: "waiting" }, scraper: { status: "waiting" }, etl: { status: "waiting" } },
      cursor: { phase: "reset-storage", page: 1, afterId: null } };
    const ciphertext = encryptKey(key, id);
    await sql`INSERT INTO pipeline_control.jobs (id,status,job,key_ciphertext,key_expires_at,executor)
      VALUES (${id},'queued',${sql.json(job)},${ciphertext},now()+interval '24 hours','supabase')`;
    if (scheduled) {
      let nextRunAt = row.value.nextRunAt!;
      do { nextRunAt = nextOccurrence(new Date(nextRunAt), row.value.frequency, true); } while (Date.parse(nextRunAt) <= Date.now());
      await sql`UPDATE pipeline_control.schedule SET value=${sql.json({
        ...row.value, nextRunAt, lastTriggeredAt: startedAt,
      })} WHERE singleton=true`;
    }
    return job;
  });
}

export async function claimJob() {
  const token = randomUUID();
  const [row] = await db()<Row[]>`UPDATE pipeline_control.jobs
    SET status='running',execution_id=${token},execution_until=now()+interval '10 minutes'
    WHERE id=(SELECT id FROM pipeline_control.jobs WHERE executor='supabase'
      AND status IN ('queued','running') AND (execution_until IS NULL OR execution_until<=now())
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,status,job,key_ciphertext,key_expires_at,execution_id`;
  return row ?? null;
}
export async function publishJob(row: Row, job: Job) {
  const updated = await db()`UPDATE pipeline_control.jobs SET job=${db().json(job)},status=${job.status},
    key_ciphertext=CASE WHEN ${job.status} IN ('completed','failed') THEN NULL ELSE key_ciphertext END,
    blocked_until=CASE WHEN ${job.status}='failed' AND EXISTS (
      SELECT 1 FROM pipeline_control.operations WHERE job_id=${row.id} AND status='started'
    ) THEN 'infinity'::timestamptz ELSE blocked_until END,
    execution_id=NULL,execution_until=NULL
    WHERE id=${row.id} AND execution_id=${row.execution_id} AND status IN ('queued','running') RETURNING id`;
  if (!updated.length) {
    const [stopped] = await db()<{ cancelled: boolean }[]>`SELECT job->>'cancelled'='true' AS cancelled
      FROM pipeline_control.jobs WHERE id=${row.id}`;
    if (stopped?.cancelled) return;
    throw new Error("Pipeline lease was lost before publishing its result.");
  }
}
export function failedJob(job: Job, message: string): Job {
  job.status = "failed";
  job.error = message;
  job.finishedAt = new Date().toISOString();
  const step = job.steps[job.stage];
  if (step) { step.status = "failed"; step.finishedAt = job.finishedAt; }
  for (const step of Object.values(job.steps)) if (step.status === "waiting") step.status = "skipped";
  return job;
}
export async function expireJobs() {
  await db().begin(async (sql) => {
    const rows = await sql<Row[]>`SELECT * FROM pipeline_control.jobs
      WHERE executor='supabase' AND status IN ('queued','running') AND key_expires_at<=now() FOR UPDATE`;
    for (const row of rows) {
      const job = failedJob(row.job, "Pipeline exceeded its 24-hour lifetime; inspect logs before retrying.");
      await sql`UPDATE pipeline_control.jobs SET job=${sql.json(job)},status='failed',key_ciphertext=NULL,
        blocked_until=CASE WHEN EXISTS (SELECT 1 FROM pipeline_control.operations WHERE job_id=${row.id} AND status='started')
          THEN 'infinity'::timestamptz ELSE blocked_until END WHERE id=${row.id}`;
    }
  });
  await db()`UPDATE pipeline_control.jobs SET key_ciphertext=NULL WHERE key_expires_at<=now()`;
}
export async function operation<T>(row: Row, name: string, run: () => Promise<unknown>, validate: (v: unknown) => v is T): Promise<T> {
  return await executeOperation(name, {
    start: () => db().begin(async (sql) => {
      const active = await sql`SELECT id FROM pipeline_control.jobs WHERE id=${row.id}
        AND execution_id=${row.execution_id} AND status IN ('queued','running') AND key_expires_at>now() FOR UPDATE`;
      if (!active.length) throw new HttpError(409, "Pipeline is no longer active or its key expired.");
      const inserted = await sql`INSERT INTO pipeline_control.operations(job_id,name,status)
        VALUES (${row.id},${name},'started') ON CONFLICT DO NOTHING RETURNING name`;
      return inserted.length > 0;
    }),
    read: async () => {
      const [saved] = await db()<{ status: string; result: unknown }[]>`SELECT status,result
        FROM pipeline_control.operations WHERE job_id=${row.id} AND name=${name}`;
      return saved;
    },
    complete: async (result) => {
      await db()`SELECT pipeline_control.complete_edge_operation(
        ${row.id}::uuid,${name},${db().json(JSON.parse(JSON.stringify(result)))})`;
    },
  }, run, validate);
}
export function rowKey(row: Row) {
  if (!row.key_ciphertext || new Date(row.key_expires_at).getTime() <= Date.now()) throw new HttpError(409, "Pipeline key expired.");
  return decryptKey(row.key_ciphertext, row.id);
}
