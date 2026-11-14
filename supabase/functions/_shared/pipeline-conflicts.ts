import { HttpError } from "./runtime.ts";

export type Conflict = {
  id: string; status: string; executor: string; blocked: boolean | null; operation: string | null;
};

export function pipelineConflict(rows: Conflict[], restartId?: string): HttpError | undefined {
  const target = restartId ? rows.find((row) => row.id === restartId && row.executor === "supabase") : undefined;
  if (restartId && !target) return new HttpError(409, "The selected pipeline run no longer exists or is not an Edge run. Refresh the pipeline status.");
  const blocked = rows.find((row) => row.blocked);
  const uncertain = blocked ?? (target?.operation ? target : undefined);
  if (uncertain) {
    const operation = uncertain.operation && /^(reset-storage|reset-mongodb|reset-postgresql|scrape-\d+|etl-(first|\d+))$/.test(uncertain.operation)
      ? uncertain.operation : "an operation";
    return new HttpError(409, `Run ${uncertain.id} is blocked: ${operation} has no confirmed outcome. Inspect that run's operation and service logs before retrying. Stopping or resetting cron does not resolve this blocker.`);
  }
  const active = rows.find((row) => row.id !== restartId && ["queued", "running"].includes(row.status));
  if (active) return new HttpError(409, `Run ${active.id} is already ${active.status}. Wait for it or stop that run before starting another pipeline.`);
}
