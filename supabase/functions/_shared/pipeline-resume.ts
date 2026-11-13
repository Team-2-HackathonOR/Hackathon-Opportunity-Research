import { db, HttpError } from "./runtime.ts";
import { encryptKey } from "./pipeline-keys.ts";
import type { Job } from "./pipeline.ts";

export async function resumeJob(id: string, key: string): Promise<Job> {
  try {
    const [row] = await db()<{ job: Job }[]>`SELECT pipeline_control.resume_edge_job(
      ${id}::uuid,${encryptKey(key, id)}) AS job`;
    if (!row?.job) throw new HttpError(409, "No checkpoint was queued. Refresh the pipeline status before continuing.");
    return row.job;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001") {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}
