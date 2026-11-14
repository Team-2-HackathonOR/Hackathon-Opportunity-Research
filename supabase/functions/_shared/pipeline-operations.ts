import { db, HttpError, PipelineFailure } from "./runtime.ts";
import { executeOperation } from "./operation.ts";
import { handleOperationFailure, MAX_OPERATION_ATTEMPTS } from "./pipeline-retry.ts";
import type { Row } from "./pipeline.ts";

export async function operation<T>(row: Row, name: string, run: () => Promise<unknown>,
  validate: (value: unknown) => value is T): Promise<T> {
  return await executeOperation(name, {
    start: () => db().begin(async (sql) => {
      const active = await sql`SELECT id FROM pipeline_control.jobs WHERE id=${row.id}
        AND execution_id=${row.execution_id} AND status IN ('queued','running')
        AND execution_until>now() AND key_expires_at>now() FOR UPDATE`;
      if (!active.length) throw new HttpError(409, "Pipeline is no longer active or its key expired.");
      const inserted = await sql`INSERT INTO pipeline_control.operations(job_id,name,status)
        VALUES (${row.id},${name},'started') ON CONFLICT DO NOTHING RETURNING name`;
      if (inserted.length) return true;
      const [saved] = await sql<{ status: string; attempts: number; replay_safe: boolean; ready: boolean }[]>`
        SELECT status,attempts,replay_safe,(next_attempt_at IS NULL OR next_attempt_at<=now()) AS ready
        FROM pipeline_control.operations WHERE job_id=${row.id} AND name=${name} FOR UPDATE`;
      if (!saved || saved.status !== "started") return false;
      const fencedETL = name.startsWith("etl-") && row.job.etlReceiptVersion === 1;
      if (fencedETL) {
        const [receipt] = await sql<{ acknowledgement: unknown }[]>`SELECT acknowledgement
          FROM pipeline_control.etl_receipts WHERE job_id=${row.id} AND operation_name=${name}`;
        if (receipt) {
          if (!validate(receipt.acknowledgement)) throw new PipelineFailure(502, "ETL_RECEIPT_INVALID", "uncertain", "The saved ETL receipt is invalid.");
          await sql`SELECT pipeline_control.complete_edge_operation(${row.id}::uuid,${name},${JSON.stringify(receipt.acknowledgement)}::text::jsonb)`;
          return false;
        }
        if (fencedETL && saved.attempts >= MAX_OPERATION_ATTEMPTS) {
          await sql`UPDATE pipeline_control.operations SET status='completed',replay_safe=true,next_attempt_at=NULL,
            result=${sql.json({ outcome: "confirmed-failure", replaySafe: true, code: "ETL_RETRY_EXHAUSTED",
              message: "ETL stopped after bounded attempts; the fenced receipt check confirmed no pending event commit." })}
            WHERE job_id=${row.id} AND name=${name} AND status='started'`;
          return false;
        }
      }
      if ((saved.replay_safe || fencedETL) && saved.ready && saved.attempts < MAX_OPERATION_ATTEMPTS) {
        await sql`UPDATE pipeline_control.operations SET attempts=attempts+1,replay_safe=false,next_attempt_at=NULL
          WHERE job_id=${row.id} AND name=${name} AND status='started'`;
        return true;
      }
      return false;
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
    onFailure: (error) => handleOperationFailure(row, name, error),
  }, run, validate);
}
