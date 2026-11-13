import type { Job } from "../_shared/pipeline.ts";
import { executeOperation, type OperationLedger } from "../_shared/operation.ts";
import { HttpError } from "../_shared/runtime.ts";
import { advanceStorageReset, isResetAcknowledgement, resetOperationName } from "./reset-step.ts";

function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const initialJob = (): Job => ({
  id: "test-job", status: "running", stage: "reset", startedAt: "2026-11-13T00:00:00.000Z",
  reset: {}, steps: { reset: { status: "running" } },
  cursor: { phase: "reset-storage", page: 1, afterId: null },
});

Deno.test("reset batch acknowledgement replays without deleting again or double-counting durable progress", async () => {
  let saved: { status: string; result: unknown } | undefined;
  let deletes = 0;
  const ledger: OperationLedger = {
    start: () => {
      if (saved) return Promise.resolve(false);
      saved = { status: "started", result: null };
      return Promise.resolve(true);
    },
    read: () => Promise.resolve(saved),
    complete: (result) => { saved = { status: "completed", result }; return Promise.resolve(); },
  };
  const durable = initialJob();
  const invoke = () => { deletes++; return Promise.resolve({ reset: false, deletedRecords: 100, hasMore: true }); };
  const first = await executeOperation(resetOperationName(durable), ledger, invoke, isResetAcknowledgement);
  const unpublished = structuredClone(durable);
  advanceStorageReset(unpublished, first);
  const replay = await executeOperation(resetOperationName(durable), ledger, invoke, isResetAcknowledgement);
  advanceStorageReset(durable, replay);
  assert(deletes === 1 && durable.reset.storage === 100, "Lost progress acknowledgement repeated deletion or counted twice.");
  assert(durable.cursor.phase === "reset-storage" && resetOperationName(durable) === "reset-storage-2", "Partial reset advanced to PostgreSQL or reused the same operation.");
  advanceStorageReset(durable, { reset: true, deletedRecords: 98, hasMore: false });
  assert(durable.reset.storage === 198 && durable.cursor.phase === "reset-postgresql", "Final batch lost cumulative progress.");
  assert(durable.cursor.page === 1 && durable.cursor.resetBatch === undefined, "Reset changed the scraper page cursor.");
});

Deno.test("reset preserves legacy completed acknowledgements but rejects inconsistent partial summaries", () => {
  const job = initialJob();
  const legacy = { reset: true, deletedRecords: 9998 };
  assert(isResetAcknowledgement(legacy), "A previously completed reset could not replay.");
  if (!isResetAcknowledgement(legacy)) throw new Error("Legacy acknowledgement is invalid.");
  advanceStorageReset(job, legacy);
  assert(job.reset.storage === 9998 && job.cursor.phase === "reset-postgresql", "Legacy complete reset was repeated.");
  for (const invalid of [
    { reset: false, deletedRecords: 100 },
    { reset: true, deletedRecords: 100, hasMore: true },
    { reset: false, deletedRecords: 0, hasMore: true },
    { reset: true, deletedRecords: 101, hasMore: false },
  ]) assert(!isResetAcknowledgement(invalid), "Invalid batch looked acknowledged.");
  const emptyJob = initialJob();
  advanceStorageReset(emptyJob, { reset: true, deletedRecords: 0, hasMore: false });
  assert(emptyJob.cursor.phase === "reset-postgresql", "An empty reset did not finish.");
});

Deno.test("new reset batching cannot bypass an old unacknowledged reset-storage operation", async () => {
  const job = initialJob();
  const ledger: OperationLedger = {
    start: () => Promise.resolve(false),
    read: () => Promise.resolve({ status: "started", result: null }),
    complete: () => Promise.reject(new Error("Must not acknowledge an uncertain operation.")),
  };
  let deletes = 0;
  let blocked = false;
  try {
    await executeOperation(resetOperationName(job), ledger, () => {
      deletes++;
      return Promise.resolve({ reset: true, deletedRecords: 0, hasMore: false });
    }, isResetAcknowledgement);
  } catch (error) { blocked = error instanceof HttpError && error.status === 409; }
  assert(blocked && deletes === 0 && resetOperationName(job) === "reset-storage", "Batching bypassed the old reset interlock.");
});
