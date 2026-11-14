import { db, HttpError } from "./runtime.ts";
import { encryptKey } from "./pipeline-keys.ts";
import type { Job } from "./pipeline.ts";
import { preflightPipeline } from "./pipeline-preflight.ts";

export async function resumeJob(id: string, key: string): Promise<Job> {
  const etlReceiptVersion = await preflightPipeline();
  try {
    return await db().begin(async (sql) => {
      await sql`SELECT singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE`;
      await sql`SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='hackscout-edge-tick'),active:=true)`;
      const [row] = await sql<{ job: Job }[]>`SELECT pipeline_control.resume_edge_job(
        ${id}::uuid,${encryptKey(key, id)}) AS job`;
      if (!row?.job) throw new HttpError(409, "No checkpoint was queued. Refresh the pipeline status before continuing.");
      const job = { ...row.job, etlReceiptVersion };
      const phase = job.cursor.phase;
      const operation = phase === "scraper" ? `scrape-${job.cursor.page}`
        : phase === "etl" ? `etl-${job.cursor.afterId ?? "first"}`
        : phase === "reset-storage" && (job.cursor.resetBatch ?? 1) > 1 ? `reset-storage-${job.cursor.resetBatch}` : phase;
      await sql`UPDATE pipeline_control.operations SET status='started',result=NULL,attempts=0,
        retry_cycle=retry_cycle+1,replay_safe=true,next_attempt_at=NULL
        WHERE job_id=${id} AND name=${operation} AND status='completed' AND replay_safe
        AND result @> '{"outcome":"confirmed-failure","replaySafe":true}'::jsonb`;
      await sql`UPDATE pipeline_control.jobs SET job=${sql.json(job)} WHERE id=${id}`;
      return job;
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001") {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}
