import { db } from "./runtime.ts";
import { StorageError } from "./service-errors.ts";

export type IndexScope = { bucket: string; prefix: string };
export type StagingMetadata = {
  fetched_at_ms: number; source_id: number; object_name: string; sha256: string; byte_size: number;
};
export const MAX_RUN_RECORDS = 9998;

export function indexFailure(mutation = false): StorageError {
  const error = new StorageError(mutation ? "STORAGE_MUTATION_UNCONFIRMED" : "STORAGE_RESPONSE_INVALID", 503);
  error.message = mutation
    ? "Storage may have changed but its private staging index was not confirmed. Retain the interlock and verify before retrying."
    : "The private staging index is missing or inconsistent. Apply the staging index migration and verify Storage; do not treat this as an empty run.";
  return error;
}

export function validateMetadata(row: StagingMetadata): StagingMetadata {
  const ms = Number(row.fetched_at_ms), id = Number(row.source_id), size = Number(row.byte_size);
  if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime()) ||
      !Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(size) || size < 1 || size > 250000 ||
      row.object_name !== `${ms}_${String(id).padStart(16, "0")}.json` || !/^[a-f0-9]{64}$/.test(row.sha256)) {
    throw indexFailure();
  }
  return { ...row, fetched_at_ms: ms, source_id: id, byte_size: size };
}

// This server-only adapter is replaceable by the offline Storage test fixture.
export const stagingIndex = {
  async ready(scope: IndexScope, fetchedAt: number | null): Promise<void> {
    try {
      const [ack] = await db()<{ ready: boolean }[]>`SELECT pipeline_control.require_staging_index_ready(
        ${scope.bucket},${scope.prefix},${fetchedAt}) AS ready`;
      if (ack?.ready !== true) throw indexFailure();
    } catch { throw indexFailure(); }
  },
  async list(scope: IndexScope, fetchedAt: number | null, afterId: number | null, limit: number): Promise<StagingMetadata[]> {
    try {
      const rows = fetchedAt === null
        ? await db()<StagingMetadata[]>`
          SELECT DISTINCT ON (source_id) fetched_at_ms,source_id,object_name,sha256,byte_size
          FROM pipeline_control.staging_index WHERE bucket=${scope.bucket} AND prefix=${scope.prefix}
          AND (${afterId}::bigint IS NULL OR source_id>${afterId})
          ORDER BY source_id,fetched_at_ms DESC LIMIT ${limit}`
        : await db()<StagingMetadata[]>`
          SELECT fetched_at_ms,source_id,object_name,sha256,byte_size
          FROM pipeline_control.staging_index WHERE bucket=${scope.bucket} AND prefix=${scope.prefix}
          AND fetched_at_ms=${fetchedAt} AND (${afterId}::bigint IS NULL OR source_id>${afterId})
          ORDER BY source_id LIMIT ${limit}`;
      return rows.map(validateMetadata);
    } catch { throw indexFailure(); }
  },
  async count(scope: IndexScope, fetchedAt: number): Promise<number> {
    try {
      const [row] = await db()<{ count: string }[]>`SELECT count(*)::text AS count
        FROM pipeline_control.staging_index
        WHERE bucket=${scope.bucket} AND prefix=${scope.prefix} AND fetched_at_ms=${fetchedAt}`;
      const count = Number(row?.count);
      if (!Number.isSafeInteger(count) || count < 0 || count > MAX_RUN_RECORDS) throw indexFailure();
      return count;
    } catch { throw indexFailure(); }
  },
  async prepare(scope: IndexScope, row: StagingMetadata): Promise<void> {
    try {
      const [ack] = await db()<{ prepared: boolean }[]>`SELECT pipeline_control.prepare_staging_object(
        ${scope.bucket},${scope.prefix},${row.fetched_at_ms},${row.source_id},
        ${row.object_name},${row.sha256},${row.byte_size}) AS prepared`;
      if (ack?.prepared !== true) throw indexFailure(true);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "54000") {
        throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
      }
      throw indexFailure(true);
    }
  },
  async confirm(scope: IndexScope, row: StagingMetadata): Promise<void> {
    try {
      const [ack] = await db()<{ confirmed: boolean }[]>`SELECT pipeline_control.confirm_staging_object(
        ${scope.bucket},${scope.prefix},${row.fetched_at_ms},${row.source_id},
        ${row.object_name},${row.sha256},${row.byte_size}) AS confirmed`;
      if (ack?.confirmed !== true) throw indexFailure(true);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "54000") {
        throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
      }
      throw indexFailure(true);
    }
  },
  async remove(scope: IndexScope, names: string[], complete: boolean): Promise<void> {
    try {
      // complete means a bounded actual Storage scan and exact deletion ACK confirmed no owned objects remain.
      await db()`DELETE FROM pipeline_control.staging_index
        WHERE bucket=${scope.bucket} AND prefix=${scope.prefix}
        AND (${complete} OR object_name=ANY(${names}::text[]))`;
    } catch { throw indexFailure(true); }
  },
};
