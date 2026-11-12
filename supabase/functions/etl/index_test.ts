import { handleETL, etlPath, parseRecords } from "./index.ts";
import { handleRequest } from "../scraper/index.ts";
import { buildBaseEvent } from "../_shared/etl/normalization-base.ts";
import { mergeAiPayload } from "../_shared/etl/normalization.ts";
import { eventSchema } from "../_shared/etl/schema.ts";
import { encryptKey, decryptKey, nextOccurrence } from "../_shared/pipeline.ts";

function assert(value: boolean, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
const headers = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };

Deno.test("both functions reject direct callers before health, parsing, scheduling, or database access", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", headers["x-gateway-secret"]);
  try {
    for (const [handler, functionName, paths] of [
      [handleRequest, "scraper", ["", "/health", "/pipeline", "/pipeline/run", "/pipeline/tick", "/schedule", "/hackathons/reset"]],
      [handleETL, "etl", ["", "/health", "/events", "/team-members", "/etl/import/mongodb", "/etl/import/file"]],
    ] as const) {
      for (const path of paths) {
        for (const method of ["GET", "POST", "OPTIONS"]) {
          const response = await handler(new Request(`https://example.test/functions/v1/${functionName}${path}`, {
            method, headers: { "x-gateway-caller": "team-2-gateway", authorization: "Bearer browser-token" },
            ...(method === "POST" ? { body: "invalid json" } : {}),
          }));
          assert(response.status === 403, `${functionName}${path} ${method} was exposed`);
        }
      }
      const health = await handler(new Request(`https://example.test/functions/v1/${functionName}/health`, { headers }));
      assert(health.status === 200, "Authenticated health should work without database configuration.");
    }
    const viewer = await handleRequest(new Request("https://example.test/functions/v1/scraper/pipeline", {
      headers: { ...headers, "x-user-role": "viewer" },
    }));
    assert(viewer.status === 403, "Pipeline control must not accept viewer identities.");
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});

Deno.test("ETL function paths preserve gateway-facing endpoint paths", () => {
  assert(etlPath("https://example.test/functions/v1/etl/etl/import/mongodb") === "/etl/import/mongodb");
  assert(etlPath("https://example.test/etl/etl/import/file") === "/etl/import/file");
  assert(etlPath("https://example.test/etl/import/mongodb") === "/etl/import/mongodb");
  assert(etlPath("https://example.test/functions/v1/etl/events") === "/events");
  assert(etlPath("https://example.test/etl/team-members") === "/team-members");
});

Deno.test("base normalization retains source mapping, category dedupe, status and contributions", () => {
  const event = buildBaseEvent({ title: "Test", location: "Rome, Lazio, Italy", themes: ["AI", "AI", { name: "Web" }],
    status: "Open", prizeAmount: "$100", url: "https://event.test", sourceUrl: "https://devpost.com/api/hackathons",
    startSubmissionUrl: "https://event.test/register" }, 1, 2);
  assert(event.event_name === "Test" && event.format === "in_person" && event.country === "Italy");
  assert(event.operational_status === "verified_apply_now" && event.evidence_confidence === "low");
  assert(event.categories.length === 2 && event.categories[0].is_primary && !event.categories[1].is_primary);
  assert(event.sources.length === 3 && event.benefits[0].award_value === "$100");
  assert(event.contributions.length === 2 && event.contributions[1].member_id === 2);
  assert(buildBaseEvent({ title: "Remote", location: "Online", status: "ended" }, null, null).format === "virtual");
});

Deno.test("AI merge sanitizes known aliases without erasing verified base data", () => {
  const base = buildBaseEvent({ title: "Test", url: "https://verified.test" }, 1, null);
  const result = mergeAiPayload(base, {
    official_website: null, event_start_date: "2027-01-02T00:00:00Z",
    tracks: [{ track_type: "mini_challenge", track_name: "Sponsor" }],
    benefits: [{ benefit_type: "recognition", description: "Recognition" }],
    application_requirement_items: [{ queue_type: "apply", requirement_type: "cv", title: "Upload CV", status: "in progress" }],
    verifications: [{ result: "partial", title: "Check publisher" }],
  });
  assert(result.official_website === "https://verified.test" && result.event_start_date === "2027-01-02");
  assert(result.tracks[0].track_type === "sponsor_challenge" && result.benefits[0].benefit_type === "career_exposure");
  assert(result.application_requirement_items[0].requirement_type === "resume" && result.contributions.length === 1);
  assert(result.verifications.length === 0, "Never invent a researcher in AI verifications.");
  assert(!eventSchema.safeParse({ ...result, operational_status: "invented" }).success);
});

Deno.test("file parser supports JSON, JSONL and quoted multiline CSV and rejects invalid records", () => {
  assert(parseRecords("input.json", '{"records":[{"title":"Test"}]}')[0].title === "Test");
  assert(parseRecords("input.jsonl", '\n{"title":"One"}\n{"title":"Two"}\n').length === 2);
  assert(parseRecords("input.csv", '\uFEFFtitle,notes\r\nTest,"line one\nline two"\r\n')[0].notes === "line one\nline two");
  for (const [filename, value] of [["input.json", "[1]"], ["input.jsonl", "false"], ["input.xml", "x"]]) {
    let failed = false;
    try { parseRecords(filename, value); } catch { failed = true; }
    assert(failed, "Invalid file must not import.");
  }
});

Deno.test("temporary key encryption is job-bound and never plaintext", () => {
  const old = Deno.env.get("PIPELINE_KEY_ENCRYPTION_KEY");
  Deno.env.set("PIPELINE_KEY_ENCRYPTION_KEY", btoa("a".repeat(32)));
  try {
    const ciphertext = encryptKey("private-test-key", "job-one");
    assert(!ciphertext.includes("private-test-key") && decryptKey(ciphertext, "job-one") === "private-test-key");
    let rejected = false;
    try { decryptKey(ciphertext, "job-two"); } catch { rejected = true; }
    assert(rejected, "Another job cannot decrypt the key.");
  } finally {
    if (old === undefined) Deno.env.delete("PIPELINE_KEY_ENCRYPTION_KEY");
    else Deno.env.set("PIPELINE_KEY_ENCRYPTION_KEY", old);
  }
});

Deno.test("Rome schedules preserve spring DST, fall DST, monthly and biweekly behavior", () => {
  assert(nextOccurrence(new Date("2027-03-27T12:00:00Z"), "weekly") === "2027-03-28T01:00:00.000Z");
  assert(nextOccurrence(new Date("2027-10-30T12:00:00Z"), "weekly") === "2027-10-31T00:00:00.000Z");
  assert(nextOccurrence(new Date("2027-01-03T01:00:00Z"), "biweekly", true) === "2027-01-17T01:00:00.000Z");
  assert(nextOccurrence(new Date("2027-01-02T12:00:00Z"), "monthly") === "2027-02-01T01:00:00.000Z");
});
