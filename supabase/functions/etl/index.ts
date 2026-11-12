import { parse as parseCsv } from "npm:csv-parse@6.1.0/sync";
import { ZodError } from "npm:zod@3.25.76";
import { authorize, HttpError, json, readJson, safeError } from "../_shared/runtime.ts";
import { stagingStore,type StagingStore } from "../_shared/staging-storage.ts";
import { StorageError,storageFailure } from "../_shared/service-errors.ts";
import { eventSchema, storageImportSchema, type RawRecord } from "../_shared/etl/schema.ts";
import { buildBaseEvent } from "../_shared/etl/normalization-base.ts";
import { normalizeWithAi } from "../_shared/etl/normalization.ts";
import { createEvent, createTeamMember } from "../_shared/etl/writer.ts";

export function etlPath(url: string): string {
  let path = new URL(url).pathname.replace(/^\/functions\/v1\/etl(?=\/|$)/, "");
  if (path === "/etl") return "/";
  if (/^\/etl\/(?:etl\/|events(?:\/|$)|team-members(?:\/|$))/.test(path)) path = path.slice(4);
  return path || "/";
}
const isRecord = (value: unknown): value is RawRecord => !!value && typeof value === "object" && !Array.isArray(value);
export function parseRecords(filename: string, text: string): RawRecord[] {
  let records: unknown;
  const suffix = filename.split(".").pop()?.toLowerCase();
  try {
    if (suffix === "json") {
      const payload: unknown = JSON.parse(text);
      records = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.records) ? payload.records : [payload];
    } else if (suffix === "jsonl") records = text.split(/\r?\n/).filter((v) => v.trim()).map((line) => JSON.parse(line));
    else if (suffix === "csv") records = parseCsv(text, { columns: true, bom: true, skip_empty_lines: true });
    else throw new HttpError(400, "Supported file types are .json, .jsonl, and .csv.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Uploaded file contains invalid JSON or CSV.");
  }
  if (!Array.isArray(records) || !records.every(isRecord)) throw new HttpError(400, "Each record must be a JSON object.");
  return records;
}

function importLimit(records: RawRecord[], useAi: boolean) {
  if (records.length > (useAi ? 1 : 25)) throw new HttpError(400,
    `Edge imports accept at most ${useAi ? 1 : 25} records per request. Split the input into bounded batches before importing.`);
}

async function importRecords(records: RawRecord[], source: string, useAi: boolean, key: string, researcher: number | null, verifier: number | null) {
  importLimit(records, useAi);
  if (useAi && !key.trim()) throw new HttpError(503, "AI_API_KEY is required when AI normalization is enabled.");
  const successes: { record_index: number; source_identifier: string | null; event_id: number; event_name: string }[] = [];
  const failures: { record_index: number; source_identifier: string | null; reason: string }[] = [];
  const deadline = Date.now() + 100000;
  for (const [record_index, raw] of records.entries()) {
    const identifier = ["id", "event_name", "title", "name", "url"].map((k) => raw[k]).find((v) => v !== null && v !== undefined && String(v).trim());
    const source_identifier = identifier === undefined ? null : String(identifier);
    try {
      if (Date.now() >= deadline - 5000) throw new HttpError(504, "ETL import budget exhausted. Split the input into smaller batches.");
      let payload = buildBaseEvent(raw, researcher, verifier);
      if (useAi) payload = await normalizeWithAi(raw, payload, key);
      const event = await createEvent(payload, deadline);
      successes.push({ record_index, source_identifier, event_id: event.event_id, event_name: event.event_name });
    } catch (error) {
      const integrity = error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("23");
      if (!(error instanceof ZodError) && !(error instanceof HttpError) && !integrity) throw error;
      console.warn("ETL record failed.", { record_index, kind: error instanceof Error ? error.name : "unknown" });
      failures.push({ record_index, source_identifier, reason: error instanceof HttpError ? error.message
        : error instanceof ZodError ? "Record does not satisfy the event schema." : "Database integrity error while inserting the event." });
    }
  }
  return { source, processed_count: records.length, inserted_count: successes.length, failed_count: failures.length, successes, failures, next_after_id: null as number | null };
}

export function createETLHandler(overrides: { store?: StagingStore; importer?: typeof importRecords } = {}) {
  const store = overrides.store ?? stagingStore;
  const importer = overrides.importer ?? importRecords;
  return async (request: Request): Promise<Response> => {
  try {
    authorize(request);
    const path = etlPath(request.url);
    if (request.method === "GET" && (path === "/" || path === "/health")) return json({ detail: "Hackathon Research ETL API is running." });
    if (request.method !== "POST") throw new HttpError(404, "Unknown ETL route.");
    const apiKey = request.headers.get("x-ai-api-key")?.trim() || Deno.env.get("AI_API_KEY")?.trim() || "";
    if (apiKey.length > 4096) throw new HttpError(400, "The AI API key is too long.");
    if (path === "/events") return json(await createEvent(eventSchema.parse(await readJson(request, 1_000_000))), 201);
    if (path === "/team-members") return json(await createTeamMember(await readJson(request)), 201);
    if (path === "/etl/import/storage" || path === "/etl/import/mongodb") {
      const payload = storageImportSchema.parse(await readJson(request));
      if (payload.database_name || payload.collection_name) throw new HttpError(400, "MongoDB database/collection overrides are retired. Staging uses the server-configured private Storage bucket and prefix.");
      if (payload.after_id !== null && !payload.cursor_mode) throw new HttpError(400, "after_id requires cursor_mode.");
      if (payload.limit === null && !payload.fetched_at) throw new HttpError(400, "An unlimited import requires a scraper fetched_at timestamp.");
      if (payload.cursor_mode && (!payload.fetched_at || payload.limit !== 1)) throw new HttpError(400, "Cursor imports require fetched_at and a one-record limit.");
      const max = payload.use_ai_normalization ? 1 : 25;
      if (payload.limit === null || payload.limit > max) throw new HttpError(400, `Edge Storage imports require limit <= ${max}. Use cursor_mode for a full run.`);
      const records = await store.read(payload.fetched_at, payload.after_id, payload.limit);
      const result = await importer(records, "storage", payload.use_ai_normalization, apiKey, payload.primary_researcher_id, payload.verifier_id);
      if (payload.cursor_mode && records.length) result.next_after_id = records[records.length - 1].id;
      return json(result);
    }
    if (path === "/etl/import/file") {
      if (Number(request.headers.get("content-length")) > 1_000_000) throw new HttpError(413, "File request exceeds 1 MB.");
      const reader = request.body?.getReader();
      if (!reader) throw new HttpError(400, "A multipart file upload is required.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 1_000_000) { await reader.cancel(); throw new HttpError(413, "File request exceeds 1 MB."); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Upload a file.");
      const useAiText = form.get("use_ai_normalization") ?? "true";
      if (typeof useAiText !== "string" || !["true", "false", "1", "0"].includes(useAiText.toLowerCase())) throw new HttpError(422, "Invalid use_ai_normalization value.");
      const useAi = ["true", "1"].includes(useAiText.toLowerCase());
      const member = (name: string) => {
        const value = form.get(name);
        if (value === null || value === "") return null;
        if (typeof value !== "string" || !/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpError(422, "Invalid team member ID.");
        return Number(value);
       };
      return json(await importer(parseRecords(file.name, await file.text()), file.name, useAi, apiKey,
        member("primary_researcher_id"), member("verifier_id")));
    }
    throw new HttpError(404, "Unknown ETL route.");
  } catch (error) {
    if (error instanceof StorageError) return json(storageFailure(error), error.status);
    if (error instanceof ZodError) {
      console.warn("ETL request validation failed.");
      return json({ detail: "Request does not satisfy the ETL schema.", errors: error.issues.map((v) => ({ path: v.path, message: v.message })) }, 422);
    }
    return safeError(error);
  }
 };
}

export const handleETL = createETLHandler();
if (import.meta.main) Deno.serve(handleETL);
