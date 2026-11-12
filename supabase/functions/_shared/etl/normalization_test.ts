import { normalizeWithAi } from "./normalization.ts";
import { buildBaseEvent } from "./normalization-base.ts";
import { findMatchingSourceEntry } from "./normalization-helpers.ts";
import { publicUrl } from "./normalization-web.ts";
import { HttpError } from "../runtime.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

Deno.test("directory evidence matches actual identifiers, not two missing URL fields", () => {
  const payload = { hackathons: [{ id: 2, title: "Wrong record" }, { id: 1, title: "Correct record" }] };
  assert(findMatchingSourceEntry({ id: 1 }, payload)?.title === "Correct record", "Matched unrelated directory evidence.");
  assert(findMatchingSourceEntry({ id: 3 }, payload) === undefined, "Missing identifiers matched a record.");
});

Deno.test("ETL fetches evidence, uses the per-run key only for completion, and validates AI output", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = Deno.env.get("AI_BASE_URL");
  Deno.env.set("AI_BASE_URL", "https://api.example.test/v1");
  let prompt = "";
  let webCalls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://api.example.test/v1/chat/completions") {
        assert(new Headers(init?.headers).get("authorization") === "Bearer fixture-per-run-key", "Per-run key was lost.");
        prompt = String(init?.body);
        return Response.json({ choices: [{ message: { content: '```json\n{"event_name":"Verified Test","format":"virtual","evidence_confidence":"high"}\n```' } }] });
      }
      assert(!new Headers(init?.headers).has("authorization"), "AI credential leaked to an evidence website.");
      assert(url.startsWith("https://8.8.8.8/"), "Unexpected evidence destination.");
      webCalls++;
      if (url.endsWith("/api/hackathons")) return Response.json({ hackathons: [
        { id: 9, title: "Wrong", url: "https://8.8.8.8/wrong" },
        { id: 1, title: "Test", url: "https://8.8.8.8/event", start_a_submission_url: "https://8.8.8.8/apply" },
      ] });
      return new Response("<title>Official Test</title><p>Verified organizer evidence</p>", {
        headers: { "content-type": "text/html" },
      });
    };
    const raw = { id: 1, title: "Test", sourceUrl: "https://8.8.8.8/api/hackathons", url: "https://8.8.8.8/event" };
    const result = await normalizeWithAi(raw, buildBaseEvent(raw, null, null), "fixture-per-run-key");
    assert(result.event_name === "Verified Test" && result.format === "virtual" && result.evidence_confidence === "high", "AI result did not merge.");
    assert(webCalls >= 2 && prompt.includes("Verified organizer evidence") && prompt.includes("Official Test"), "Prompt omitted fetched evidence.");
    assert(result.registration_fee_amount === null && result.verifications.length === 0, "Unknown facts or member IDs were invented.");
    globalThis.fetch = () => Promise.resolve(Response.json({ choices: [{ message: { content: "not JSON" } }] }));
    let failed = false;
    try { await normalizeWithAi({}, buildBaseEvent({ title: "Test" }, null, null), "fixture-per-run-key"); }
    catch (error) { failed = error instanceof HttpError && error.status === 422; }
    assert(failed, "Invalid AI output must fail explicitly.");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) Deno.env.delete("AI_BASE_URL");
    else Deno.env.set("AI_BASE_URL", previousBase);
  }
});

Deno.test("evidence requests reject non-public and credential-bearing destinations", async () => {
  for (const url of ["https://127.0.0.1/x", "https://10.1.2.3/x", "https://169.254.169.254/x", "https://[::1]/x", "https://user:pass@8.8.8.8/", "file:///etc/passwd"]) {
    let rejected = false;
    try { await publicUrl(url); } catch { rejected = true; }
    assert(rejected, "Non-public evidence URL was allowed.");
  }
});
