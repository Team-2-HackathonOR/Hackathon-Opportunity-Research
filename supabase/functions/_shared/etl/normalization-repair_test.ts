import { normalizeWithAi } from "./normalization.ts";
import { buildBaseEvent } from "./normalization-base.ts";
import { createETLHandler } from "../../etl/index.ts";
import { stagingStore } from "../staging-storage.ts";
import { HttpError } from "../runtime.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
type Message = { role: string; content: string };
type Call = { messages: Message[]; signal: AbortSignal | null | undefined };
const invalid = { format: "private-invalid-value", evidence_confidence: "high", primary_researcher_id: 123 };
const raw = { id: 310, title: "Test", fetchedAt: "2026-11-13T14:06:28.409Z" };

async function mockedAi(outputs: object[], run: (calls: Call[], logs: unknown[][]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const calls: Call[] = [];
  const logs: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => { logs.push(args); };
    globalThis.fetch = (input, init) => {
      assert(String(input).endsWith("/chat/completions"), "Unexpected network destination.");
      assert(new Headers(init?.headers).get("authorization") === "Bearer fixture-repair-key", "Correction lost the per-run key.");
      const body: { messages: Message[] } = JSON.parse(String(init?.body));
      calls.push({ messages: body.messages, signal: init?.signal });
      const output = outputs.shift();
      if (!output) throw new Error("Unbounded AI retry.");
      return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    };
    await run(calls, logs);
  } finally {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
  }
}

Deno.test("invalid AI schema gets one correction using the same budget and value-free validation feedback", async () => {
  await mockedAi([invalid, { format: "virtual", evidence_confidence: "high" }], async (calls, logs) => {
    const base = buildBaseEvent(raw, null, null);
    const result = await normalizeWithAi(raw, base, "fixture-repair-key");
    assert(result.format === "virtual", "Corrected output was not validated and merged.");
    assert(calls.length === 2, "Expected exactly one correction request.");
    assert(calls[0].signal === calls[1].signal, "Correction restarted the AI time budget.");
    const messages = calls[1].messages;
    assert(messages.some((m) => m.role === "assistant" && m.content.includes(invalid.format)), "Original output was lost.");
    const feedback = messages[messages.length - 1].content;
    assert(feedback.includes("format") && feedback.includes("invalid_enum_value"), "Correction omitted schema diagnostics.");
    assert(!feedback.includes(invalid.format), "Validation feedback exposed the invalid value.");
    const logged = JSON.stringify(logs);
    assert(logged.includes("format") && !logged.includes(invalid.format) && !logged.includes("fixture-repair-key"),
      "Diagnostic logs omitted the field or exposed record values/credentials.");
    assert(result.official_website === null && result.verifications.length === 0 && result.contributions.length === 0
      && base.contributions.length === 0, "Rejected output contaminated the original base event.");
  });
});

Deno.test("a second invalid output remains a failed record with bounded safe diagnostics and no database write", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", "fixture-repair-gateway");
  try {
    const manyErrors = { ...invalid, tracks: Array.from({ length: 25 }, () => ({ track_type: "theme" })) };
    await mockedAi([manyErrors, manyErrors], async (calls, logs) => {
      const handler = createETLHandler({ store: { ...stagingStore, read: () => Promise.resolve([raw]) } });
      const response = await handler(new Request("https://example.test/functions/v1/etl/etl/import/storage", {
        method: "POST",
        headers: { "x-gateway-secret": "fixture-repair-gateway", "x-gateway-caller": "team-2-gateway",
          "x-ai-api-key": "fixture-repair-key", "content-type": "application/json" },
        body: JSON.stringify({ fetched_at: raw.fetchedAt, after_id: 307, cursor_mode: true, limit: 1 }),
      }));
      const result = await response.json();
      assert(response.status === 200 && result.failed_count === 1 && result.inserted_count === 0, "Invalid record was accepted.");
      assert(calls.length === 2 && result.next_after_id === 310, "Correction was unbounded or lost the failed source ID.");
      assert(result.failures[0].source_identifier === "310", "Failed-record identity was lost.");
      assert(result.failures[0].validation_errors.length === 20, "Validation diagnostics exceeded their 20-issue bound.");
      assert(result.failures[0].validation_errors.some((v: { path: string[]; code: string }) =>
        v.path[0] === "format" && v.code === "invalid_enum_value"), "Acknowledgement omitted safe validation details.");
      assert(!JSON.stringify(result).includes(invalid.format) && !JSON.stringify(logs).includes(invalid.format),
        "Failure acknowledgement or logs exposed an invalid record value.");
    });

  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});

Deno.test("correction budget exhaustion fails explicitly without starting another AI budget", async () => {
  const previousFetch = globalThis.fetch;
  const previousTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  let calls = 0;
  try {
    AbortSignal.timeout = (milliseconds) => milliseconds === 45000 ? controller.signal : previousTimeout(milliseconds);
    globalThis.fetch = (_input, init) => {
      calls++;
      if (calls === 1) return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] }));
      assert(init?.signal === controller.signal, "Correction received a fresh budget.");
      controller.abort(new DOMException("Test timeout", "TimeoutError"));
      return Promise.reject(controller.signal.reason);
    };
    let failed = false;
    try { await normalizeWithAi(raw, buildBaseEvent(raw, null, null), "fixture-repair-key"); }
    catch (error) {
      failed = error instanceof HttpError && error.status === 503 &&
        "code" in error && error.code === "AI_PROVIDER_TIMEOUT";
    }
    assert(failed && calls === 2, "Exhausted correction budget did not produce a retryable provider timeout.");
  } finally {
    globalThis.fetch = previousFetch;
    AbortSignal.timeout = previousTimeout;
  }
});

Deno.test("AI provider failures are not retried as schema corrections", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = () => { calls++; return Promise.resolve(new Response(null, { status: 429 })); };
    let failed = false;
    try { await normalizeWithAi(raw, buildBaseEvent(raw, null, null), "fixture-repair-key"); }
    catch (error) { failed = error instanceof HttpError && error.status === 503; }
    assert(failed && calls === 1, "Provider failure was hidden or retried.");
  } finally { globalThis.fetch = previousFetch; }
});
