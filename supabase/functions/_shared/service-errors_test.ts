import { HttpError, safeError } from "./runtime.ts";
import { StorageError, storageErrors, storageFailure, serviceJson } from "./service-errors.ts";
import { pipelineConflict, type Conflict } from "./pipeline-conflicts.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
const secret = "mongodb://private-user:private-password@private-host/private-db";

Deno.test("Storage failures reach pipeline errors without forwarding credentials or upstream messages", async () => {
  for (const code of ["STORAGE_CONFIG_MISSING", "STORAGE_PERMISSION_DENIED", "STORAGE_TIMEOUT"] as const) {
    const failure = storageFailure(new StorageError(code, 503));
    assert(failure.code === code && failure.error === storageErrors[code], "Incorrect Storage diagnostic.");
    let caught: unknown;
    try { await serviceJson(Response.json({ ...failure, error: secret }, { status: 500 })); }
    catch (error) { caught = error; }
    assert(caught instanceof HttpError && caught.status === 502 && caught.message.includes(`[${code}]`),
      "Targeted service error was lost before reaching pipeline progress.");
    assert(caught instanceof Error && !caught.message.includes("private-"), "Private upstream details leaked.");
  }
});

Deno.test("unrecognized upstream errors remain failures with actionable safe HTTP diagnostics", async () => {
  for (const [status, code, hint] of [
    [403, "unknown", "gateway caller/shared-secret"],
    [404, "__proto__", "deployed service URL"],
    [500, "toString", "raw response is not exposed"],
  ] as const) {
    let caught: unknown;
    try { await serviceJson(Response.json({ error: secret, code }, { status })); }
    catch (error) { caught = error; }
    assert(caught instanceof HttpError && caught.message.includes(hint), "Missing actionable HTTP diagnostic.");
    assert(caught instanceof Error && !caught.message.includes("private-"), "Raw service error leaked.");
  }
  let malformed: unknown;
  try { await serviceJson(new Response("not JSON", { status: 500 })); }
  catch (error) { malformed = error; }
  assert(malformed instanceof HttpError && malformed.message.includes("without a valid JSON error"),
    "Malformed error response was not diagnosed.");
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(8193))); },
    cancel() { cancelled = true; },
  });
  let oversized: unknown;
  try { await serviceJson(new Response(body, { status: 500 })); }
  catch (error) { oversized = error; }
  assert(cancelled && oversized instanceof HttpError && oversized.message.includes("oversized error body"),
    "Unbounded upstream error body was not cancelled.");
});

Deno.test("pipeline conflicts distinguish active runs, uncertain operations, and missing targets", () => {
  const row: Conflict = { id: "fixture-run", executor: "supabase", status: "running", blocked: false, operation: null };
  assert(pipelineConflict([row])?.message.includes("already running") === true, "Active run not identified.");
  const blocked = pipelineConflict([{ ...row, status: "failed", blocked: true, operation: "reset-mongodb" }]);
  assert(blocked?.message.includes("fixture-run") === true && blocked.message.includes("reset-mongodb") &&
    blocked.message.includes("no confirmed outcome"), "Uncertain operation not identified.");
  const historical = pipelineConflict([{ ...row, status: "failed", operation: "reset-mongodb" }], row.id);
  assert(historical?.message.includes("no confirmed outcome") === true, "Historical restart interlock was lost.");
  assert(pipelineConflict([], row.id)?.message.includes("no longer exists") === true, "Missing target not identified.");
  assert(pipelineConflict([row], row.id) === undefined, "Safe restart of target run was incorrectly blocked.");
  assert(pipelineConflict([{ ...row, status: "failed", operation: "reset-mongodb" }]) === undefined,
    "Historical operation incorrectly blocked a fresh run after reconciliation.");
  const unsafe = pipelineConflict([{ ...row, blocked: true, operation: secret }]);
  assert(unsafe !== undefined && !unsafe.message.includes("private-"), "Unrecognized operation name leaked.");
});

Deno.test("known PostgreSQL diagnostics reach clients without leaking statements or connection details", async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    for (const [code, hint] of [["42501", "permission denied"], ["42883", "migrations"], ["28P01", "authentication failed"]]) {
      const error = Object.assign(new Error(secret), { name: "PostgresError", code });
      const response = safeError(error);
      const payload = await response.json();
      assert(response.status === 503 && payload.error.includes(hint), "Database diagnostic was lost.");
      assert(!JSON.stringify(payload).includes("private-"), "Database credentials reached client.");
    }
    assert(!JSON.stringify(logged).includes("private-"), "Database credentials reached logs.");
  } finally { console.error = original; }
});
