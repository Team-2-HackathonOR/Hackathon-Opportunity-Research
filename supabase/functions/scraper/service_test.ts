import type { DevpostHackathon } from "../_shared/scraper/models.ts";
import type { StagingStore, StagedRecord } from "../_shared/staging-storage.ts";
import { StorageError } from "../_shared/service-errors.ts";
import { buildDevpostUrl,mapHackathon } from "./scraper-io.ts";
import { createScraperHandler } from "./service.ts";
import { stagingStore } from "../_shared/staging-storage.ts";
import { storageFixture } from "../_shared/storage-test-fixture.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
const sample: DevpostHackathon = {
  id: 1, title: "Test", open_state: "open", thumbnail_url: "//images.test/image",
  url: "https://event.test", time_left_to_submission: "10 days", submission_period_dates: "November",
  prize_amount: "<b>$100</b>", prizes_counts: { cash: 1, other: 0 }, registrations_count: 10,
  featured: false, organization_name: "Test Organizer", winners_announced: false,
  submission_gallery_url: "https://event.test/gallery", start_a_submission_url: "https://event.test/register",
  invite_only: false, managed_by_devpost_badge: true, themes: [{ id: 1, name: "AI" }],
};
const emptyStore: StagingStore = {
  persist: () => Promise.resolve(), read: () => Promise.resolve([]),
  count: () => Promise.resolve(0), reset: () => Promise.resolve({ deletedRecords: 0, hasMore: false }),
  ids: () => Promise.resolve(new Set()),
};

Deno.test("scraper preserves source mapping and strips only control query parameters", () => {
  const mapped = mapHackathon(sample);
  assert(mapped.prizeAmount === "$100" && mapped.thumbnailUrl === "https://images.test/image", "Mapping changed.");
  assert(mapped.themes[0] === "AI" && mapped.location === "Unknown", "Missing mapped category or location.");
  const url = new URL(buildDevpostUrl(new URLSearchParams("persist=true&startPage=2&maxPages=1&search=ai&search=web"), true, 2));
  assert(url.origin === "https://devpost.com" && url.searchParams.get("page") === "2", "Wrong upstream page.");
  assert(!url.searchParams.has("maxPages") && url.searchParams.getAll("search").length === 2, "Filters were not preserved.");
});

Deno.test("bounded scraper persists run metadata to Storage and reports exact run acknowledgement", async () => {
  let written: StagedRecord[] = [];
  let pages = 0;
  const fetchedAt = "2026-11-12T10:00:00.000Z";
  const handler = createScraperHandler({
    store: { ...emptyStore,
      persist: (records) => { written = records; return Promise.resolve(); },
      count: (timestamp) => { assert(timestamp === fetchedAt, "Count lost the run timestamp."); return Promise.resolve(written.length); },
    },
    page: () => {
      pages++;
      return Promise.resolve({ ok: true, statusCode: 200, body: { hackathons: [sample], meta: { total_pages: 2 } } });
    },
    analyze: (_payload, requestedPage) => Promise.resolve({
      analysisEngine: "deterministic", requestedPage, hackathonsOnPage: 1, totalCount: 2, perPage: 1,
      totalPages: 2, hasMorePages: requestedPage < 2, canFetchAllPages: true, confidence: "high", signals: [], recommendation: "Two pages.",
    }),
  });
  const path = "/hackathons/persist-all";
  assert((await handler(new Request(`https://example.test${path}`), path)).status === 400, "Unbounded crawl accepted.");
  assert(pages === 0 && written.length === 0, "Invalid request performed I/O.");
  const response = await handler(new Request(`https://example.test${path}?startPage=1&maxPages=1`, {
    headers: { "x-pipeline-fetched-at": fetchedAt },
  }), path);
  const result = await response.json();
  assert(response.status === 200 && result.runUniqueHackathonsPersisted === 1 && result.pagesPersisted === 1, "Incorrect durable batch summary.");
  assert(result.recordLimitReached === false, "Scraping stopped before the unique record cap.");
  assert(written[0].fetchedAt === fetchedAt && written[0].sourceUrl !== undefined, "Stored record lost provenance.");
});

Deno.test("Storage cleanup stays internal and returns safe diagnostics without fake acknowledgement", async () => {
  let resets = 0;
  const handler = createScraperHandler({ store: { ...emptyStore, reset: () => {
    resets++;
    return Promise.reject(new StorageError("STORAGE_BUCKET_MISSING", 404));
  } } });
  const path = "/hackathons/reset";
  const denied = await handler(new Request(`https://example.test${path}`, {
    method: "POST", headers: { "x-user-role": "admin" },
  }), path);
  assert(denied.status === 403 && resets === 0, "Browser caller could reset Storage.");
  const failed = await handler(new Request(`https://example.test${path}`, { method: "POST" }), path);
  const result = await failed.json();
  assert(failed.status === 500 && result.code === "STORAGE_BUCKET_MISSING" && !result.reset, "Reset failure looked successful.");
});

Deno.test("scraper reset reports partial cleanup until the final acknowledged batch", async () => {
  const batches = [{ deletedRecords: 100, hasMore: true }, { deletedRecords: 2, hasMore: false }];
  let index = 0;
  const handler = createScraperHandler({ store: { ...emptyStore, reset: () => Promise.resolve(batches[index++]) } });
  for (const expected of batches) {
    const response = await handler(new Request("https://example.test/hackathons/reset", { method: "POST" }), "/hackathons/reset");
    const result = await response.json();
    assert(response.status === 200 && result.deletedRecords === expected.deletedRecords, "Batch lost its deletion acknowledgement.");
    assert(result.hasMore === expected.hasMore && result.reset === !expected.hasMore, "Partial cleanup falsely completed the reset.");
  }
});

Deno.test("scraper caps a crossing page at 9,998 unique records while preserving duplicate updates", async () => {
  const fixture = storageFixture();
  const fetchedAt = "2026-11-12T10:00:00.000Z";
  const objectPath = (id: number) => `hackscout/raw/${Date.parse(fetchedAt)}_${String(id).padStart(16, "0")}.json`;
  try {
    for (let id = 0; id < 9997; id++) fixture.objects.set(objectPath(id), { id, fetchedAt });
    const handler = createScraperHandler({
      store: stagingStore,
      page: () => Promise.resolve({ ok: true, statusCode: 200, body: {
        hackathons: [{ ...sample, id: 9996, title: "Updated" }, { ...sample, id: 9997 },
          { ...sample, id: 9997, title: "Latest" }, { ...sample, id: 9998 }],
        meta: { total_pages: 2000 },
      } }),
      analyze: (_payload, requestedPage) => Promise.resolve({
        analysisEngine: "deterministic", requestedPage, hackathonsOnPage: 4, totalCount: 18000,
        perPage: 9, totalPages: 2000, hasMorePages: true, canFetchAllPages: true,
        confidence: "high", signals: [], recommendation: "Continue.",
      }),
    });
    const path = "/hackathons/persist-all";
    for (const page of [1112, 1113]) {
      const response = await handler(new Request(`https://example.test${path}?startPage=${page}&maxPages=1`, {
        headers: { "x-pipeline-fetched-at": fetchedAt },
      }), path);
      const result = await response.json();
      assert(response.status === 200 && result.persisted && result.pagesPersisted === 1, "Cap failed the scrape operation.");
      assert(result.runUniqueHackathonsPersisted === 9998 && result.recordLimitReached, "Cap did not signal scraper completion.");
      assert(result.paginationAnalysis.totalPages === 2000, "Cap changed the source pagination metadata.");
      assert(result.uniqueHackathonsPersisted === 2 && result.hackathonsPersisted === 3, "Duplicate or skipped record counts changed.");
      assert(fixture.objects.size === 9998 && !fixture.objects.has(objectPath(9998)), "Crossing page exceeded the cap.");
    }
    assert((await stagingStore.read(fetchedAt, 9995, 2)).map((record) => record.title).join() === "Updated,Latest", "Duplicates were not upserted.");
    assert((await stagingStore.read(fetchedAt, 9997, 1)).length === 0, "ETL cursor included a discarded record.");
    assert(!fixture.calls.some((call) => call.method === "POST" && call.path.endsWith("0000000000009998.json")), "Overflow record was uploaded.");
  } finally { fixture.restore(); }
});
