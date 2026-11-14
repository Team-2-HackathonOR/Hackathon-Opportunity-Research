import { db, HttpError, json } from "./runtime.ts";
import type { Row } from "./pipeline.ts";
import { stagingStore } from "./staging-storage.ts";

type Failure = {
  record_index: number; source_identifier: string | null; reason: string;
  raw_record?: Record<string, unknown>;
};
export type ImportAcknowledgement = {
  processed_count: number; inserted_count: number; failed_count: number;
  next_after_id: number | null; failures?: Failure[];
  receipt_bound?: boolean;
};

export async function archiveFailedImport(row: Row, name: string, result: ImportAcknowledgement) {
  const failure = result.failures?.[0];
  if (!failure || result.failures?.length !== 1 || failure.record_index !== 0 ||
      failure.source_identifier !== String(result.next_after_id) || typeof failure.reason !== "string" || !failure.reason.trim()) {
    throw new HttpError(502, "The failed ETL record lacks a confirmed diagnostic. Its cursor was preserved.");
  }
  const raw = failure.raw_record ?? (await stagingStore.read(row.job.startedAt, row.job.cursor.afterId, 1))[0];
  if (!raw || raw.id !== result.next_after_id || raw.fetchedAt !== row.job.startedAt) {
    throw new HttpError(409, "The original failed ETL record is unavailable or changed. Its cursor was preserved; inspect Storage and the acknowledgement.");
  }
  const sql = db();
  try {
    const [saved] = await sql<{ id: string }[]>`SELECT pipeline_control.archive_edge_dead_letter(
      ${row.id}::uuid,${row.execution_id}::uuid,${name},${JSON.stringify(raw)}::text::jsonb
    ) AS id`;
    if (!saved || typeof saved.id !== "string" || !/^[1-9][0-9]*$/.test(saved.id)) {
      throw new HttpError(503, "Dead-letter archival was not confirmed. Its cursor was preserved.");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001") throw new HttpError(409, error.message);
    throw error;
  }
}

const validId = (value: string) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
type Summary = {
  id: string; job_id: string; operation_name: string; source_record_id: string;
  fetched_at: string; created_at: string; reason: string; validation_errors: unknown;
};

export async function handleDeadLetters(request: Request, path: string) {
  if (request.method !== "GET") throw new HttpError(405, "Dead letters are read-only; no retry or discard has been requested.");
  if (path === "/pipeline/dead-letters") {
    const params = new URL(request.url).searchParams;
    const before = params.get("beforeId");
    if (params.getAll("beforeId").length > 1 || before !== null && !validId(before)) {
      throw new HttpError(400, "Choose a valid dead-letter page cursor.");
    }
    const sql = db();
    const rows = await sql<Summary[]>`SELECT id::text,job_id,operation_name,source_record_id::text,
      fetched_at,created_at,error->>'reason' AS reason,error->'validation_errors' AS validation_errors
      FROM pipeline_control.dead_letters WHERE status='pending'
        AND (${before}::bigint IS NULL OR id<${before}::bigint) ORDER BY id DESC LIMIT 21`;
    const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total
      FROM pipeline_control.dead_letters WHERE status='pending'`;
    if (!count || !Number.isSafeInteger(count.total) || count.total < 0) throw new HttpError(503, "Dead-letter count was not confirmed.");
    return json({ items: rows.slice(0, 20), total: count.total, nextBeforeId: rows.length > 20 ? rows[19].id : null });
  }
  const id = path.slice("/pipeline/dead-letters/".length);
  if (!path.startsWith("/pipeline/dead-letters/") || !validId(id)) throw new HttpError(400, "Choose a valid dead-letter record.");
  const sql = db();
  const [item] = await sql`SELECT id::text,job_id,operation_name,source_record_id::text,
    fetched_at,created_at,status,error,raw_record FROM pipeline_control.dead_letters WHERE id=${id}::bigint`;
  if (!item) throw new HttpError(404, "Dead-letter record not found; it may have been cleared.");
  return json({ item });
}
