import type { Job } from "../_shared/pipeline.ts";
import { HttpError } from "../_shared/runtime.ts";
import { MAX_RESET_RECORDS } from "../_shared/staging-storage.ts";

export type ResetAcknowledgement = { reset: true; deletedRecords: number } |
  { reset: boolean; deletedRecords: number; hasMore: boolean };

export function resetOperationName(job: Job): string {
  const batch = job.cursor.resetBatch ?? 1;
  if (!Number.isSafeInteger(batch) || batch < 1) throw new HttpError(503, "Storage reset batch cursor is invalid.");
  return batch === 1 ? "reset-storage" : `reset-storage-${batch}`;
}

export function isResetAcknowledgement(value: unknown): value is ResetAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !("deletedRecords" in value) || typeof value.deletedRecords !== "number" ||
      !Number.isSafeInteger(value.deletedRecords) || value.deletedRecords < 0 || !("reset" in value)) return false;
  // Previously completed whole-reset acknowledgements remain replayable.
  if (!("hasMore" in value)) return value.reset === true;
  return typeof value.hasMore === "boolean" && value.reset === !value.hasMore &&
    value.deletedRecords <= MAX_RESET_RECORDS && (!value.hasMore || value.deletedRecords > 0);
}

export function advanceStorageReset(job: Job, result: ResetAcknowledgement): void {
  job.reset.storage = (job.reset.storage ?? 0) + result.deletedRecords;
  if ("hasMore" in result && result.hasMore) {
    job.cursor.resetBatch = (job.cursor.resetBatch ?? 1) + 1;
  } else {
    job.cursor.phase = "reset-postgresql";
    delete job.cursor.resetBatch;
  }
}
