import { createHash } from "node:crypto";
import { indexFailure, MAX_RUN_RECORDS, stagingIndex, type StagingMetadata } from "./staging-index.ts";
import { StorageError } from "./service-errors.ts";
import { objectRecord } from "./storage-http.ts";

export function stagingIndexFixture(objects: Map<string, unknown>) {
  const original = { ...stagingIndex };
  const rows = new Map<string, StagingMetadata>();
  const pending = new Set<string>();
  const calls: { method: string; names?: string[]; complete?: boolean }[] = [];
  const state = { missing: false, failPrepare: false, failConfirm: false, failRemove: false };
  const check = () => { if (state.missing) throw indexFailure(); };
  const set = objects.set.bind(objects);
  // Direct object seeds in existing offline tests explicitly seed matching confirmed metadata too.
  objects.set = (path, record) => {
    if (!rows.has(path) && objectRecord(record) && typeof record.fetchedAt === "string" && typeof record.id === "number") {
      const text = JSON.stringify(record);
      rows.set(path, { fetched_at_ms: Date.parse(record.fetchedAt), source_id: record.id,
        object_name: path.split("/").at(-1)!, sha256: createHash("sha256").update(text).digest("hex"),
        byte_size: new TextEncoder().encode(text).length });
    }
    return set(path, record);
  };
  stagingIndex.ready = (scope, ms) => {
    check();
    calls.push({ method: "ready" });
    if ([...pending].some((key) => key.startsWith(`${scope.prefix}/`) &&
        (ms === null || rows.get(key)?.fetched_at_ms === ms))) throw indexFailure();
    return Promise.resolve();
  };
  stagingIndex.list = (scope, ms, afterId, limit) => {
    check();
    calls.push({ method: "list" });
    const selected = [...rows.entries()].filter(([key, row]) => key.startsWith(`${scope.prefix}/`) &&
      (ms === null || row.fetched_at_ms === ms) && (afterId === null || row.source_id > afterId)).map(([, row]) => row);
    selected.sort((a, b) => a.source_id - b.source_id || b.fetched_at_ms - a.fetched_at_ms);
    const latest = selected.filter((row, index) => index === 0 || selected[index - 1].source_id !== row.source_id);
    return Promise.resolve(latest.slice(0, limit));
  };
  stagingIndex.count = (scope, ms) => {
    check();
    calls.push({ method: "count" });
    const count = [...rows.entries()].filter(([key, row]) => key.startsWith(`${scope.prefix}/`) && row.fetched_at_ms === ms).length;
    if (count > MAX_RUN_RECORDS) throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    return Promise.resolve(count);
  };
  stagingIndex.prepare = (scope, row) => {
    check();
    calls.push({ method: "prepare" });
    if (state.failPrepare) throw indexFailure(true);
    const key = `${scope.prefix}/${row.object_name}`;
    if (!rows.has(key) && [...rows.values()].filter((entry) => entry.fetched_at_ms === row.fetched_at_ms).length >= MAX_RUN_RECORDS) {
      throw new StorageError("STORAGE_LIMIT_EXCEEDED", 413);
    }
    rows.set(key, row);
    pending.add(key);
    return Promise.resolve();
  };
  stagingIndex.confirm = (scope, row) => {
    check();
    calls.push({ method: "confirm" });
    if (state.failConfirm) throw indexFailure(true);
    const key = `${scope.prefix}/${row.object_name}`;
    rows.set(key, row);
    pending.delete(key);
    return Promise.resolve();
  };
  stagingIndex.remove = (scope, names, complete) => {
    check();
    calls.push({ method: "remove", names, complete });
    if (state.failRemove) throw indexFailure(true);
    for (const [key, row] of rows) {
      if (key.startsWith(`${scope.prefix}/`) && (complete || names.includes(row.object_name))) {
        rows.delete(key);
        pending.delete(key);
      }
    }
    return Promise.resolve();
  };
  return { rows, pending, state, calls, restore: () => Object.assign(stagingIndex, original) };
}
