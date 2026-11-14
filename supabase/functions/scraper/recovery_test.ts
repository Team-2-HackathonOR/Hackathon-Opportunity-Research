import { PipelineFailure } from "../_shared/runtime.ts";
import { requestJson } from "../_shared/scraper/http.ts";
import { analyzePagination } from "../_shared/scraper/analyzer.ts";
import { createScraperHandler } from "./service.ts";

const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
Deno.test("deterministic pagination does not call AI when source metadata is sufficient", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Pagination unexpectedly contacted AI."); };
  try {
    const result = await analyzePagination({ hackathons: [], meta: { total_count: 14335, per_page: 9 } }, 299, "fixture-key");
    assert(result.analysisEngine === "deterministic" && result.totalPages === 1593, "Reliable pagination was not used.");
  } finally { globalThis.fetch = original; }
});
Deno.test("source reads retry transient HTTP failures but not authorization failures", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => Promise.resolve(++calls === 1
    ? Response.json({}, { status: 503 }) : Response.json({ ok: true }));
  try {
    const result = await requestJson<{ ok: boolean }>("https://fixture.test", { headers: {}, timeoutMs: 2000 });
    assert(result.ok && result.body.ok && calls === 2, "Transient source failure was not retried.");
    calls = 0;
    globalThis.fetch = () => { calls++; return Promise.resolve(Response.json({}, { status: 403 })); };
    const rejected = await requestJson("https://fixture.test", { headers: {}, timeoutMs: 2000 });
    assert(!rejected.ok && rejected.statusCode === 403 && calls === 1, "Authorization failure was retried.");
  } finally { globalThis.fetch = original; }
});
Deno.test("confirmed pre-write source failure returns retry classification without touching Storage", async () => {
  let writes = 0;
  const handler = createScraperHandler({
    page: () => Promise.reject(new PipelineFailure(503, "SOURCE_TIMEOUT", "retry", "Source request timed out.")),
    now: () => "2026-11-13T00:00:00.000Z",
    analyze: () => { throw new Error("Analysis must not run."); },
    store: {
      persist: () => { writes++; return Promise.resolve(); }, read: () => Promise.resolve([]),
      ids: () => Promise.resolve(new Set()), count: () => Promise.resolve(0),
      reset: () => Promise.resolve({ deletedRecords: 0, hasMore: false }),
    },
  });
  const response = await handler(new Request("https://fixture.test/hackathons/persist-all?startPage=299&maxPages=1"),
    "/hackathons/persist-all");
  const result = await response.json();
  assert(response.status === 503 && result.failure?.disposition === "retry" && writes === 0,
    "A read timeout was treated as an uncertain mutation.");
});
