import { HttpError } from "./runtime.ts";

export interface OperationLedger {
  start(): Promise<boolean>;
  read(): Promise<{ status: string; result: unknown } | undefined>;
  complete(result: unknown): Promise<void>;
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
    throw new HttpError(409, `Operation ${name} has an uncertain outcome. Inspect logs before starting another run.`);
  }
  const result = await run();
  if (!validate(result)) throw new HttpError(502, `Operation ${name} returned an invalid summary.`);
  await ledger.complete(result);
  return result;
}
