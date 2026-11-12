import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import pg from "pg";

let singleton;
export class PipelineStateError extends Error {}

export function getStore() {
  if (!singleton) {
    if (!process.env.DATABASE_URL) {
      throw Object.assign(new Error("Worker DATABASE_URL is required."), { code: "DATABASE_URL_MISSING" });
    }
    singleton = new PipelineStore(new pg.Pool({
      connectionString: process.env.DATABASE_URL, max: 3,
      connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, statement_timeout: 15000,
    }));
  }
  return singleton;
}

function encryptionKey() {
  const key = Buffer.from(process.env.PIPELINE_KEY_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error("PIPELINE_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key."),
      { code: "PIPELINE_KEY_ENCRYPTION_KEY_INVALID" });
  }
  return key;
}
export function encryptKey(value, jobId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(jobId));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptKey(value, jobId) {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(jobId));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export class PipelineStore {
  constructor(pool) { this.pool = pool; }

  async transaction(action) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async latest() {
    const result = await this.pool.query("SELECT job FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1");
    return result.rows[0]?.job ?? null;
  }
  async row(id, client = this.pool, lock = false) {
    const result = await client.query(`SELECT * FROM pipeline_control.jobs WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!result.rows[0]) throw new Error("Pipeline job not found.");
    return result.rows[0];
  }
  async create(apiKey, client) {
    if (!client) return this.transaction((connection) => this.create(apiKey, connection));
    await client.query("SELECT singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE");
    const active = await client.query(
      "SELECT id FROM pipeline_control.jobs WHERE status IN ('queued','running') OR blocked_until>now()",
    );
    if (active.rows.length) return null;
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const job = {
      id, status: "running", stage: "reset", reset: {}, startedAt,
      steps: {
        reset: { status: "running", startedAt },
        scraper: { status: "waiting" }, etl: { status: "waiting" },
      },
    };
    const ciphertext = encryptKey(apiKey, id);
    await client.query(
        `INSERT INTO pipeline_control.jobs(id,status,job,key_ciphertext,key_expires_at)
         VALUES($1,'queued',$2,$3,now()+interval '24 hours')`,
        [id, job, ciphertext],
    );
    return job;
  }
  async update(id, mutate) {
    return this.transaction(async (client) => {
      const row = await this.row(id, client, true);
      const job = row.job;
      if (["completed", "failed"].includes(row.status)) return job;
      mutate(job);
      await client.query(
        `UPDATE pipeline_control.jobs SET job=$2,status=$3,
         key_ciphertext=CASE WHEN $3 IN ('completed','failed') THEN NULL ELSE key_ciphertext END,
         blocked_until=CASE WHEN $3='failed' AND EXISTS (
           SELECT 1 FROM pipeline_control.operations WHERE job_id=$1 AND status='started'
         ) THEN 'infinity'::timestamptz ELSE blocked_until END
         WHERE id=$1`, [id, job, job.status],
      );
      return job;
    });
  }
  async key(id) {
    const row = await this.row(id);
    if (!row.key_ciphertext || new Date(row.key_expires_at) <= new Date() ||
        !["queued", "running"].includes(row.status)) throw new PipelineStateError("Pipeline key expired or job is no longer active.");
    return decryptKey(row.key_ciphertext, id);
  }
  async fail(id, message) {
    return this.update(id, (job) => {
      job.status = "failed";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      const step = job.steps[job.stage];
      if (step) { step.status = "failed"; step.finishedAt = job.finishedAt; }
      for (const step of Object.values(job.steps)) if (step.status === "waiting") step.status = "skipped";
    });
  }
  async operation(id, name, execute) {
    // A lost response must never replay a reset or insert: its remote outcome is unknown.
    const inserted = await this.pool.query(
      "INSERT INTO pipeline_control.operations(job_id,name,status) VALUES($1,$2,'started') ON CONFLICT DO NOTHING RETURNING name",
      [id, name],
    );
    if (!inserted.rows.length) {
      const result = await this.pool.query(
        "SELECT status,result FROM pipeline_control.operations WHERE job_id=$1 AND name=$2", [id, name],
      );
      if (result.rows[0]?.status === "completed") return result.rows[0].result;
      throw new PipelineStateError(`Operation ${name} has an uncertain outcome. Inspect service logs before starting another run.`);
    }
    const result = await execute();
    await this.pool.query(
      "UPDATE pipeline_control.operations SET status='completed',result=$3 WHERE job_id=$1 AND name=$2",
      [id, name, result],
    );
    return result;
  }
  async workflowId(id, workflowId) {
    await this.pool.query("UPDATE pipeline_control.jobs SET workflow_id=$2 WHERE id=$1", [id, workflowId]);
  }
  async expire() {
    const rows = await this.pool.query(
      "SELECT id FROM pipeline_control.jobs WHERE status IN ('queued','running') AND key_expires_at<=now()",
    );
    for (const { id } of rows.rows) await this.fail(id, "Pipeline exceeded its 24-hour lifetime; inspect service logs before retrying.");
    await this.pool.query("UPDATE pipeline_control.jobs SET key_ciphertext=NULL WHERE key_expires_at<=now()");
  }
}
