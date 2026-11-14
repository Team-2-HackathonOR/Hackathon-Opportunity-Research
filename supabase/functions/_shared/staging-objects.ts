import { StorageError } from "./service-errors.ts";
import { encodePath, objectRecord, requirePrivateBucket, storageRequest } from "./storage-http.ts";
import { type StagingMetadata, validateMetadata } from "./staging-index.ts";

export const MAX_OBJECTS = 10000;
const FILE = /^(-?\d+)_(\d{16})\.json$/;
export const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new StorageError("STORAGE_RECORD_INVALID", 422);
  return parsed;
};
export const fileName = (record: { fetchedAt: string; id: number }) =>
  `${timestamp(record.fetchedAt)}_${String(record.id).padStart(16, "0")}.json`;
type Config = Awaited<ReturnType<typeof requirePrivateBucket>>;

export async function metadata(record: Record<string, unknown> & { fetchedAt: string; id: number }): Promise<StagingMetadata> {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (!Number.isSafeInteger(record.id) || record.id < 0 || bytes.length > 250000) {
    throw new StorageError("STORAGE_RECORD_INVALID", 422);
  }
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return { fetched_at_ms: timestamp(record.fetchedAt), source_id: record.id, object_name: fileName(record),
    byte_size: bytes.length, sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

export async function names(config: Config, signal: AbortSignal, fetchedAt?: string, take = MAX_OBJECTS + 1) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset <= MAX_OBJECTS; offset += 1000) {
    const entries = await storageRequest(`object/list/${encodeURIComponent(config.bucket)}`, "POST", signal, {
      prefix: config.prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" },
      ...(fetchedAt ? { search: `${timestamp(fetchedAt)}_` } : {}),
    });
    if (!Array.isArray(entries) || entries.length > 1000 ||
        entries.some((entry) => !objectRecord(entry) || typeof entry.name !== "string")) {
      throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
    }
    if (offset + entries.length > MAX_OBJECTS) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    for (const entry of entries) {
      if (objectRecord(entry) && typeof entry.name === "string" && entry.id !== null && FILE.test(entry.name) &&
          (!fetchedAt || entry.name.startsWith(`${timestamp(fetchedAt)}_`))) {
        const id = Number(FILE.exec(entry.name)![2]);
        if (!Number.isSafeInteger(id) || id < 0) throw new StorageError("STORAGE_RECORD_INVALID", 502);
        if (seen.has(entry.name)) throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
        seen.add(entry.name);
        result.push(entry.name);
        if (result.length === take) return result;
      }
    }
    if (entries.length < 1000) return result;
  }
  throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
}

export async function download(config: Config, signal: AbortSignal, input: StagingMetadata) {
  const row = validateMetadata(input);
  const record = await storageRequest(`object/${encodePath(`${config.bucket}/${config.prefix}/${row.object_name}`)}`, "GET", signal);
  if (!objectRecord(record) || record.id !== row.source_id || typeof record.fetchedAt !== "string" ||
      fileName({ id: row.source_id, fetchedAt: record.fetchedAt }) !== row.object_name) {
    throw new StorageError("STORAGE_RECORD_INVALID", 502);
  }
  const actual = await metadata({ ...record, id: row.source_id, fetchedAt: record.fetchedAt });
  if (actual.sha256 !== row.sha256 || actual.byte_size !== row.byte_size) throw new StorageError("STORAGE_RECORD_INVALID", 502);
  return { ...record, id: row.source_id, fetchedAt: record.fetchedAt };
}
