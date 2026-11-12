import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { db, env, HttpError } from "./runtime.ts";
import { executeOperation } from "./operation.ts";

type Step = { status: string; startedAt?: string; finishedAt?: string };
export type Job = {
  id: string; status: string; stage: string; startedAt: string; finishedAt?: string; error?: string;
  reset: Record<string, number>; steps: Record<string, Step>;
  scraper?: { pagesPersisted: number; uniqueHackathonsPersisted: number };
  etl?: { processed: number; inserted: number; failed: number };
  cursor: { phase: string; page: number; afterId: number | null };
};
type Row = {
  id: string; status: string; job: Job; key_ciphertext: string | null; key_expires_at: Date;
  execution_id: string | null;
};
type Schedule = { frequency: string; nextRunAt: string | null; lastTriggeredAt?: string };

function encryptionKey() {
  const key = Buffer.from(env("PIPELINE_KEY_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new HttpError(503, "Pipeline encryption key must decode to 32 bytes.");
  return key;
}
export function encryptKey(value: string, id: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export function decryptKey(value: string, id: string) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
}

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
  return { ...row.value, timeZone: "Europe/Rome", time: "02:00", keyConfigured: !!Deno.env.get("AI_API_KEY")?.trim(), lastError: null };
}
export async function latestJob() {
  const [row] = await db()<{ job: Job }[]>`SELECT job FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1`;
  return row?.job ?? null;
}

export async function createJob(key: string, scheduled = false) {
  return await db().begin(async (sql) => {
    const [row] = await sql<{ value: Schedule }[]>`SELECT value FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE`;
    if (!row) throw new HttpError(503, "Apply the pipeline control migration.");
    if (scheduled && (row.value.frequency === "off" || !row.value.nextRunAt || Date.parse(row.value.nextRunAt) > Date.now())) return null;
    const active = await sql`SELECT id FROM pipeline_control.jobs WHERE status IN ('queued','running') OR blocked_until>now()`;
    if (active.length) return null;
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const job: Job = { id, status: "running", stage: "reset", reset: {}, startedAt,
      steps: { reset: { status: "running", startedAt }, scraper: { status: "waiting" }, etl: { status: "waiting" } },
      cursor: { phase: "reset-mongodb", page: 1, afterId: null } };
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
    SET execution_id=${token},execution_until=now()+interval '10 minutes'
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
  if (!updated.length) throw new Error("Pipeline lease was lost before publishing its result.");
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
      await db()`UPDATE pipeline_control.operations SET status='completed',result=${db().json(JSON.parse(JSON.stringify(result)))}
        WHERE job_id=${row.id} AND name=${name}`;
    },
  }, run, validate);
}
export function rowKey(row: Row) {
  if (!row.key_ciphertext || new Date(row.key_expires_at).getTime() <= Date.now()) throw new HttpError(409, "Pipeline key expired.");
  return decryptKey(row.key_ciphertext, row.id);
}
