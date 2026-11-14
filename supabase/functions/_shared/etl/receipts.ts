import { db, PipelineFailure } from "../runtime.ts";
import type postgres from "npm:postgres@3.4.7";
import { storageConfig } from "../storage-http.ts";
import { metadata } from "../staging-objects.ts";
import type { StagedRecord } from "../staging-storage.ts";

export type PipelineImportContext = {
  pipeline_job_id: string; pipeline_operation: string; pipeline_execution_id: string;
  fetched_at: string; after_id: number | null;
};
export type ImportReceipt = {
  receipt_bound: true;
  source: string; processed_count: number; inserted_count: number; failed_count: number;
  successes: { record_index: number; source_identifier: string | null; event_id: number; event_name: string }[];
  failures: never[]; next_after_id: number | null;
};
export type ReceiptWrite = { context: PipelineImportContext; sourceId: number; sourceIdentifier: string | null; source: StagedRecord };
type Sql = postgres.TransactionSql;

export async function guardPipelineImport(sql: Sql, context: PipelineImportContext): Promise<ImportReceipt | null> {
  try {
    const [row] = await sql<{ receipt: ImportReceipt | null }[]>`SELECT pipeline_control.etl_import_context(
      ${context.pipeline_job_id}::uuid,${context.pipeline_operation},${context.pipeline_execution_id}::uuid,
      ${context.fetched_at},${context.after_id}::bigint) AS receipt`;
    return row.receipt;
  } catch (error) { return rethrowConflict(error); }
}

export async function readPipelineReceipt(context: PipelineImportContext) {
  return await db().begin((sql) => guardPipelineImport(sql, context));
}

export function successfulReceipt(event: { event_id: number; event_name: string }, write: ReceiptWrite): ImportReceipt {
  return { receipt_bound: true, source: "storage", processed_count: 1, inserted_count: 1, failed_count: 0,
    successes: [{ record_index: 0, source_identifier: write.sourceIdentifier, ...event }],
    failures: [], next_after_id: write.sourceId };
}

export async function storePipelineReceipt(sql: Sql, context: PipelineImportContext, source: StagedRecord | null, receipt: ImportReceipt) {
  const { bucket, prefix } = storageConfig();
  const hash = source === null ? null : (await metadata(source)).sha256;
  try { await sql`SELECT pipeline_control.save_etl_receipt(
    ${context.pipeline_job_id}::uuid,${context.pipeline_operation},${context.pipeline_execution_id}::uuid,
    ${context.fetched_at},${context.after_id}::bigint,${bucket},${prefix},
    ${JSON.stringify(source)}::text::jsonb,${hash},${sql.json(receipt)})`;
  } catch (error) { rethrowConflict(error); }
}

export async function validatePipelineSource(context: PipelineImportContext, source: StagedRecord) {
  const { bucket, prefix } = storageConfig();
  const hash = (await metadata(source)).sha256;
  return await db().begin(async (sql) => {
    await guardPipelineImport(sql, context);
    try { await sql`SELECT pipeline_control.etl_source_context(
      ${context.fetched_at},${context.after_id}::bigint,${bucket},${prefix},
      ${sql.json(JSON.parse(JSON.stringify(source)))},${hash})`;
    } catch (error) { rethrowConflict(error); }
  });
}

export async function emptyPipelineReceipt(context: PipelineImportContext) {
  return await db().begin(async (sql) => {
    const saved = await guardPipelineImport(sql, context);
    if (saved) return saved;
    const receipt: ImportReceipt = { receipt_bound: true, source: "storage", processed_count: 0, inserted_count: 0,
      failed_count: 0, successes: [], failures: [], next_after_id: null };
    await storePipelineReceipt(sql, context, null, receipt);
    return receipt;
  });
}

export function receiptConflict(): never {
  throw new PipelineFailure(409, "ETL_CONTEXT_CONFLICT", "uncertain", "Pipeline import source or receipt conflicts with its saved context.");
}

function rethrowConflict(error: unknown): never {
  if (error instanceof Error && "code" in error && error.code === "P0001") receiptConflict();
  throw error;
}
