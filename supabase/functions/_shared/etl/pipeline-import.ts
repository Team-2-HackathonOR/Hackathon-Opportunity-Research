import { HttpError } from "../runtime.ts";
import type { StagedRecord } from "../staging-storage.ts";
import { buildBaseEvent } from "./normalization-base.ts";
import { normalizeWithAi } from "./normalization.ts";
import { createEvent } from "./writer.ts";
import { emptyPipelineReceipt, readPipelineReceipt, validatePipelineSource, type PipelineImportContext } from "./receipts.ts";
import { ZodError } from "npm:zod@3.25.76";
import { validationIssues } from "./schema.ts";

export async function importPipelineRecord(context: PipelineImportContext, read: () => Promise<StagedRecord[]>,
  useAi: boolean, key: string, researcher: number | null, verifier: number | null,
  normalize = normalizeWithAi) {
  const saved = await readPipelineReceipt(context);
  if (saved) return saved;
  const deadline = Date.now() + 100000;
  const records = await read();
  if (!records.length) return await emptyPipelineReceipt(context);
  if (records.length !== 1) throw new HttpError(409, "Pipeline cursor must select exactly one source.");
  const raw = records[0];
  if (!Number.isSafeInteger(raw.id) || raw.id < 0 || Date.parse(raw.fetchedAt) !== Date.parse(context.fetched_at) ||
      context.after_id !== null && raw.id <= context.after_id) {
    throw new HttpError(409, "Pipeline source does not match its run and cursor.");
  }
  const sourceIdentifier = String(raw.id);
  await validatePipelineSource(context, raw);
  try {
    if (useAi && !key.trim()) throw new HttpError(503, "AI_API_KEY is required when AI normalization is enabled.");
    let payload = buildBaseEvent(raw, researcher, verifier);
    if (useAi) payload = await normalize(raw, payload, key);
    const event = await createEvent(payload, deadline, {
      context, sourceId: raw.id, sourceIdentifier, source: raw,
    });
    if (!event.receipt) throw new HttpError(503, "Pipeline event was not acknowledged.");
    return event.receipt;
  } catch (error) {
    const integrity = error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("23");
    if (error instanceof HttpError && [409, 503, 504].includes(error.status) ||
        !(error instanceof ZodError) && !(error instanceof HttpError) && !integrity) throw error;
    const details = error instanceof ZodError ? { validation_errors: validationIssues(error) } : {};
    console.warn("ETL record failed.", { record_index: 0, kind: error instanceof Error ? error.name : "unknown", ...details });
    return { receipt_bound: true, source: "storage", processed_count: 1, inserted_count: 0, failed_count: 1, successes: [],
      failures: [{ record_index: 0, source_identifier: sourceIdentifier, raw_record: raw,
        reason: error instanceof HttpError ? error.message : error instanceof ZodError
          ? "Record does not satisfy the event schema." : "Database integrity error while inserting the event.", ...details }],
      next_after_id: raw.id };
  }
}
