import { StorageError } from "./service-errors.ts";
import { encodePath, objectRecord, requirePrivateBucket, storageRequest } from "./storage-http.ts";
import { indexFailure, MAX_RUN_RECORDS, stagingIndex, validateMetadata } from "./staging-index.ts";
import { download, MAX_OBJECTS, metadata, names, timestamp } from "./staging-objects.ts";

export type StagedRecord = Record<string, unknown> & { id: number; fetchedAt: string };
export type StorageResetBatch = { deletedRecords: number; hasMore: boolean };
export const MAX_RESET_RECORDS = 100;
export interface StagingStore {
  persist(records: StagedRecord[]): Promise<void>;
  read(fetchedAt: string | null, afterId: number | null, limit: number): Promise<StagedRecord[]>;
  count(fetchedAt: string): Promise<number>;
  ids(fetchedAt: string): Promise<Set<number>>;
  reset(): Promise<StorageResetBatch>;
}

async function indexedRows(config: Awaited<ReturnType<typeof requirePrivateBucket>>, fetchedAt: number | null,
  afterId: number | null, limit: number) {
  await stagingIndex.ready(config, fetchedAt);
  const rows = await stagingIndex.list(config, fetchedAt, afterId, limit);
  if (!Array.isArray(rows) || rows.length > limit) throw indexFailure();
  let previous = afterId ?? -1;
  for (const input of rows) {
    const row = validateMetadata(input);
    if (row.source_id <= previous || fetchedAt !== null && row.fetched_at_ms !== fetchedAt) throw indexFailure();
    previous = row.source_id;
  }
  return rows.map(validateMetadata);
}

// Destructive controls must verify physical originals, not trust an indexed count alone.
export async function verifyStagedCount(fetchedAt: string): Promise<number> {
  const signal = AbortSignal.timeout(25000);
  const config = await requirePrivateBucket(signal);
  const rows = await indexedRows(config, timestamp(fetchedAt), null, MAX_RUN_RECORDS + 1);
  const files = await names(config, signal, fetchedAt);
  const expected = new Set(rows.map((row) => row.object_name));
  if (rows.length > MAX_RUN_RECORDS || files.length !== expected.size || files.some((name) => !expected.has(name))) {
    throw indexFailure();
  }
  return files.length;
}

export const stagingStore: StagingStore = {
  async persist(records) {
    if (records.length > 1000) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    const unique = new Map<string, { row: Awaited<ReturnType<typeof metadata>>; record: StagedRecord }>();
    for (const record of records) {
      const row = await metadata(record);
      unique.set(row.object_name, { row, record });
    }
    const entries = [...unique.values()];
    // Durable unconfirmed intents prevent an acknowledged upload/index failure from looking like an empty run.
    for (const { row } of entries) await stagingIndex.prepare(config, row);
    for (let offset = 0; offset < entries.length; offset += 10) {
      await Promise.all(entries.slice(offset, offset + 10).map(async ({ row, record }) => {
        const path = `${config.bucket}/${config.prefix}/${row.object_name}`;
        const result = await storageRequest(`object/${encodePath(path)}`, "POST", signal, record);
        if (!objectRecord(result) || result.Key !== path) throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502);
        await stagingIndex.confirm(config, row);
      }));
    }
  },
  async count(fetchedAt) {
    const config = await requirePrivateBucket(AbortSignal.timeout(25000));
    const ms = timestamp(fetchedAt);
    await stagingIndex.ready(config, ms);
    return await stagingIndex.count(config, ms);
  },
  async ids(fetchedAt) {
    const config = await requirePrivateBucket(AbortSignal.timeout(25000));
    const rows = await indexedRows(config, timestamp(fetchedAt), null, MAX_RUN_RECORDS + 1);
    if (rows.length > MAX_RUN_RECORDS) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    return new Set(rows.map((row) => row.source_id));
  },
  async read(fetchedAt, afterId, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBJECTS ||
        afterId !== null && (!Number.isSafeInteger(afterId) || afterId < 0)) {
      throw new StorageError("STORAGE_RECORD_INVALID", 422);
    }
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    const selected = await indexedRows(config, fetchedAt === null ? null : timestamp(fetchedAt), afterId, limit);
    if (fetchedAt !== null && selected.length > MAX_RUN_RECORDS) throw indexFailure();
    const result: StagedRecord[] = [];
    let bytes = 0;
    for (let offset = 0; offset < selected.length; offset += 10) {
      const batch = await Promise.all(selected.slice(offset, offset + 10).map(async (row) => {
        bytes += row.byte_size;
        if (bytes > 8_000_000) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
        return await download(config, signal, row);
      }));
      result.push(...batch);
    }
    return result;
  },
  async reset() {
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    const files = await names(config, signal, undefined, MAX_RESET_RECORDS + 1);
    const selected = files.slice(0, MAX_RESET_RECORDS);
    const paths = selected.map((name) => `${config.prefix}/${name}`);
    let hasMore = files.length > MAX_RESET_RECORDS;
    if (paths.length) {
      try {
        const removed = await storageRequest(`object/${encodeURIComponent(config.bucket)}`, "DELETE", signal, { prefixes: paths });
        if (!Array.isArray(removed) || removed.length !== paths.length ||
            new Set(removed.map((entry) => objectRecord(entry) ? entry.name : undefined)).size !== paths.length ||
            removed.some((entry) => !objectRecord(entry) || typeof entry.name !== "string" || !paths.includes(entry.name))) {
          throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502);
        }
      } catch {
        // Never resend an ambiguous DELETE: verify the exact plan using a fresh bounded physical scan.
        try {
          const remaining = await names(config, AbortSignal.timeout(25000));
          if (selected.some((name) => remaining.includes(name))) throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502);
          hasMore = remaining.length > 0;
        } catch { throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502); }
      }
    }
    await stagingIndex.remove(config, selected, !hasMore);
    return { deletedRecords: paths.length, hasMore };
  },
};
