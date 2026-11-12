import { executeOperation, type OperationLedger } from "./operation.ts";
import { HttpError } from "./runtime.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
const valid = (value: unknown): value is { deleted: number } =>
  typeof value === "object" && value !== null && "deleted" in value && value.deleted === 3;

Deno.test("completed operations replay persisted acknowledgement without repeating destructive work", async () => {
  let saved: { status: string; result: unknown } | undefined;
  const ledger: OperationLedger = {
    start: () => {
      if (saved) return Promise.resolve(false);
      saved = { status: "started", result: null };
      return Promise.resolve(true);
    },
    read: () => Promise.resolve(saved),
    complete: (result) => { saved = { status: "completed", result }; return Promise.resolve(); },
  };
  let calls = 0;
  const run = () => { calls++; return Promise.resolve({ deleted: 3 }); };
  assert((await executeOperation("reset", ledger, run, valid)).deleted === 3, "Missing reset acknowledgement.");
  assert((await executeOperation("reset", { ...ledger }, run, valid)).deleted === 3, "Replay lost persisted result.");
  assert(calls === 1, "Reset ran more than once.");
});

Deno.test("lost acknowledgement is interlocked rather than automatically repeated", async () => {
  let saved: { status: string; result: unknown } | undefined;
  const ledger: OperationLedger = {
    start: () => {
      if (saved) return Promise.resolve(false);
      saved = { status: "started", result: null };
      return Promise.resolve(true);
    },
    read: () => Promise.resolve(saved),
    complete: () => Promise.reject(new Error("Database acknowledgement lost.")),
  };
  let calls = 0;
  const run = () => { calls++; return Promise.resolve({ deleted: 3 }); };
  try { await executeOperation("reset", ledger, run, valid); } catch { /* Simulated interrupted delivery. */ }
  let blocked = false;
  try { await executeOperation("reset", { ...ledger }, run, valid); }
  catch (error) { blocked = error instanceof HttpError && error.status === 409; }
  assert(blocked && calls === 1, "An uncertain reset must never run twice.");
});
