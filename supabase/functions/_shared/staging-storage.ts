import { StorageError } from "./service-errors.ts";
import { encodePath, objectRecord, requirePrivateBucket, storageRequest } from "./storage-http.ts";

export type StagedRecord = Record<string, unknown> & { id: number; fetchedAt: string };
export interface StagingStore {
  persist(records: StagedRecord[]): Promise<void>;
  read(fetchedAt: string | null, afterId: number | null, limit: number): Promise<StagedRecord[]>;
  count(fetchedAt: string): Promise<number>;
  reset(): Promise<number>;
}
const MAX_OBJECTS = 10000;
const FILE = /^(-?\d+)_(\d{16})\.json$/;
const timestamp = (value: string) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new StorageError("STORAGE_RECORD_INVALID", 422);
  return String(parsed);
};
const fileName = (record: StagedRecord) => `${timestamp(record.fetchedAt)}_${String(record.id).padStart(16, "0")}.json`;
type Config = Awaited<ReturnType<typeof requirePrivateBucket>>;

async function names(config: Config, signal: AbortSignal, fetchedAt?: string) {
  const result: string[] = [];
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
          (!fetchedAt || entry.name.startsWith(`${timestamp(fetchedAt)}_`))) result.push(entry.name);
    }
    if (entries.length < 1000) return result;
  }
  throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
}

export const stagingStore: StagingStore = {
  async persist(records) {
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    if (records.length > 1000) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    const unique = new Map<string, StagedRecord>();
    for (const record of records) {
      if (!Number.isSafeInteger(record.id) || record.id < 0 ||
          new TextEncoder().encode(JSON.stringify(record)).length > 250000) {
        throw new StorageError("STORAGE_RECORD_INVALID", 422);
      }
      unique.set(fileName(record), record);
    }
    const entries = [...unique.entries()];
    for (let offset = 0; offset < entries.length; offset += 10) {
      await Promise.all(entries.slice(offset, offset + 10).map(async ([name, record]) => {
        const path = `${config.bucket}/${config.prefix}/${name}`;
        const result = await storageRequest(`object/${encodePath(path)}`, "POST", signal, record);
        if (!objectRecord(result) || result.Key !== path) throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502);
      }));
    }
  },
  async count(fetchedAt) {
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    return (await names(config, signal, fetchedAt)).length;
  },
  async read(fetchedAt, afterId, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBJECTS ||
        afterId !== null && (!Number.isSafeInteger(afterId) || afterId < 0)) {
      throw new StorageError("STORAGE_RECORD_INVALID", 422);
    }
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    const latest = new Map<number, string>();
    for (const name of await names(config, signal, fetchedAt ?? undefined)) {
      const match = FILE.exec(name);
      if (!match) throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
      const id = Number(match[2]);
      if (!Number.isSafeInteger(id) || afterId !== null && id <= afterId) continue;
      const previous = latest.get(id);
      if (!previous || Number(name.split("_")[0]) > Number(previous.split("_")[0])) latest.set(id, name);
    }
    const selected = [...latest.entries()].sort(([a], [b]) => a - b).slice(0, limit);
    const result: StagedRecord[] = [];
    let bytes = 0;
    for (let offset = 0; offset < selected.length; offset += 10) {
      const batch = await Promise.all(selected.slice(offset, offset + 10).map(async ([id, name]) => {
        const record = await storageRequest(`object/${encodePath(`${config.bucket}/${config.prefix}/${name}`)}`, "GET", signal);
        if (!objectRecord(record) || record.id !== id || typeof record.fetchedAt !== "string" ||
            fileName({ id, fetchedAt: record.fetchedAt }) !== name) throw new StorageError("STORAGE_RECORD_INVALID", 502);
        bytes += new TextEncoder().encode(JSON.stringify(record)).length;
        if (bytes > 8_000_000) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
        return { ...record, id, fetchedAt: record.fetchedAt };
      }));
      result.push(...batch);
    }
    return result;
  },
  async reset() {
    const signal = AbortSignal.timeout(25000);
    const config = await requirePrivateBucket(signal);
    const files = await names(config, signal);
    let deleted = 0;
    for (let offset = 0; offset < files.length; offset += 100) {
      const paths = files.slice(offset, offset + 100).map((name) => `${config.prefix}/${name}`);
      const removed = await storageRequest(`object/${encodeURIComponent(config.bucket)}`, "DELETE", signal, { prefixes: paths });
      if (!Array.isArray(removed) || removed.length !== paths.length ||
          new Set(removed.map((entry) => objectRecord(entry) ? entry.name : undefined)).size !== paths.length ||
          removed.some((entry) => !objectRecord(entry) || typeof entry.name !== "string" || !paths.includes(entry.name))) {
        throw new StorageError("STORAGE_MUTATION_UNCONFIRMED", 502);
      }
      deleted += removed.length;
    }
    return deleted;
  },
};
