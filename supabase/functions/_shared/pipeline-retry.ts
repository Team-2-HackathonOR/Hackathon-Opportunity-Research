import { db, HttpError, PipelineFailure, failureDetails } from "./runtime.ts";
import type { Row } from "./pipeline.ts";

export const MAX_OPERATION_ATTEMPTS = 4;
export type RetryCheckpoint = { attempt: number; maxAttempts: number; nextAttemptAt: string; code: string; message: string };
export class RetryScheduled extends HttpError {
  constructor(public checkpoint: RetryCheckpoint) {
    super(503, checkpoint.message);
    this.name = "RetryScheduled";
  }
}

export function retryDelay(attempt: number, requested = 0) {
  return Math.min(60000, Math.max(5000 * 2 ** Math.max(0, attempt - 1), requested));
}
export async function handleOperationFailure(row: Row, name: string, error: unknown): Promise<unknown> {
  const fencedETL = name.startsWith("etl-") && row.job.etlReceiptVersion === 1;
  const failure = error instanceof PipelineFailure ? error : fencedETL
    ? new PipelineFailure(503, "ETL_RESPONSE_UNCONFIRMED", "retry",
      "ETL response was lost or unavailable; the fenced receipt will be checked before retrying.") : undefined;
  const checkpoint = await db().begin(async (sql) => {
    const active = await sql`SELECT id FROM pipeline_control.jobs WHERE id=${row.id}
      AND execution_id=${row.execution_id} AND execution_until>now()
      AND status IN ('queued','running') FOR UPDATE`;
    if (!active.length) throw new HttpError(409, "The pipeline lease changed before recording recovery.");
    const [saved] = await sql<{ result: unknown }[]>`SELECT result FROM pipeline_control.operations
      WHERE job_id=${row.id} AND name=${name} AND status='completed'`;
    if (saved) return { acknowledgement: saved.result };
    if (fencedETL) {
      const [receipt] = await sql<{ acknowledgement: unknown }[]>`SELECT acknowledgement FROM pipeline_control.etl_receipts
        WHERE job_id=${row.id} AND operation_name=${name}`;
      if (receipt) return { acknowledgement: receipt.acknowledgement };
    }
    if (!failure || failure.disposition === "uncertain") return { unknown: true };
    const [operation] = await sql<{ attempts: number; retry_cycle: number }[]>`SELECT attempts,retry_cycle
      FROM pipeline_control.operations WHERE job_id=${row.id} AND name=${name} AND status='started' FOR UPDATE`;
    if (!operation) throw new HttpError(409, "The operation changed before recording recovery.");
    const details = { ...failureDetails(failure), message: failure.message };
    await sql`INSERT INTO pipeline_control.operation_attempts(job_id,operation_name,cycle,attempt,diagnostic)
      VALUES (${row.id},${name},${operation.retry_cycle},${operation.attempts},${sql.json(details)})
      ON CONFLICT (job_id,operation_name,cycle,attempt) DO NOTHING`;
    if (failure.disposition === "pause" || operation.attempts >= MAX_OPERATION_ATTEMPTS) {
      await sql`UPDATE pipeline_control.operations SET status='completed',replay_safe=true,next_attempt_at=NULL,
        result=${sql.json({ outcome: "confirmed-failure", replaySafe: true, ...details })},last_error=${sql.json(details)}
        WHERE job_id=${row.id} AND name=${name} AND status='started'`;
      return { paused: true };
    }
    const nextAttemptAt = new Date(Date.now() + retryDelay(operation.attempts, failure.retryAfterMs)).toISOString();
    await sql`UPDATE pipeline_control.operations SET replay_safe=true,next_attempt_at=${nextAttemptAt}::timestamptz,
      last_error=${sql.json(details)} WHERE job_id=${row.id} AND name=${name} AND status='started'`;
    return { retry: { attempt: operation.attempts, maxAttempts: MAX_OPERATION_ATTEMPTS,
      nextAttemptAt, code: failure.code, message: failure.message } };
  });
  if ("acknowledgement" in checkpoint) return checkpoint.acknowledgement;
  if ("retry" in checkpoint && checkpoint.retry) throw new RetryScheduled(checkpoint.retry);
  if ("unknown" in checkpoint) return undefined;
  if (!failure) throw new HttpError(503, "Recovery did not establish an operation outcome.");
  throw failure;
}
