import { randomUUID } from "node:crypto";
import { db, HttpError, json, readJson } from "./runtime.ts";
import type { Job } from "./pipeline.ts";

export async function handleClear(request: Request): Promise<Response> {
  if (request.method !== "POST") throw new HttpError(405, "Clear all requires POST.");
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !("confirmation" in payload) || payload.confirmation !== "CLEAR ALL" ||
      !("jobId" in payload) || !(payload.jobId === null ||
        typeof payload.jobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.jobId))) {
    throw new HttpError(400, "Confirm Clear all and choose the current pipeline run, or null for empty history.");
  }
  try {
    const [row] = await db()<{ job: Job }[]>`SELECT pipeline_control.enqueue_edge_clear(
      ${randomUUID()}::uuid,${payload.jobId}::uuid) AS job`;
    if (!row?.job) throw new HttpError(503, "Clear all was not queued. Refresh its status before trying again.");
    return json({ job: row.job }, 202);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001") throw new HttpError(409, error.message);
    throw error;
  }
}

export async function finishClear(row: { id: string; execution_id: string | null }): Promise<void> {
  const [result] = await db()<{ cleared: boolean }[]>`SELECT pipeline_control.finish_edge_clear(
    ${row.id}::uuid,${row.execution_id}::uuid) AS cleared`;
  if (result?.cleared !== true) throw new HttpError(503, "Clear all did not confirm removal of pipeline history.");
}
