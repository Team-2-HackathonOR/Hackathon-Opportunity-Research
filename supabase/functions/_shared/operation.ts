import { HttpError, PipelineFailure } from "./runtime.ts";

export interface OperationLedger {
  start(): Promise<boolean>;
  read(): Promise<{ status: string; result: unknown } | undefined>;
  complete(result: unknown): Promise<void>;
  onFailure?(error: unknown): Promise<unknown>;
}

export async function executeOperation<T>(
  name: string,
  ledger: OperationLedger,
  run: () => Promise<unknown>,
  validate: (value: unknown) => value is T,
): Promise<T> {
  if (!await ledger.start()) {
    const saved = await ledger.read();
    if (saved?.status === "completed" && validate(saved.result)) return saved.result;
    if (saved?.status === "completed" && saved.result && typeof saved.result === "object" &&
        "outcome" in saved.result && saved.result.outcome === "confirmed-failure" &&
        "replaySafe" in saved.result && saved.result.replaySafe === true) {
      throw new PipelineFailure(503, "OPERATION_RETRIES_EXHAUSTED", "pause",
        "Operation stopped after its bounded attempts. Continue with a fresh key or explicitly clear its data.");
    }
    throw new HttpError(409, `Operation ${name} has an uncertain outcome. Inspect logs before starting another run.`);
  }
  try {
    const result = await run();
    if (!validate(result)) throw new PipelineFailure(502, "OPERATION_ACK_INVALID", "uncertain", `Operation ${name} returned an invalid summary.`);
    await ledger.complete(result);
    return result;
  } catch (error) {
    const result = await ledger.onFailure?.(error);
    if (result === undefined) throw error;
    if (!validate(result)) throw new PipelineFailure(502, "OPERATION_ACK_INVALID", "uncertain", `Recovered operation ${name} has an invalid summary.`);
    await ledger.complete(result);
    return result;
  }
}
