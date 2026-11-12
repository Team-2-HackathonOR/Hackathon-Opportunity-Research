import type { DevpostHackathon } from "../_shared/scraper/models.ts";
import type { StagingStore, StagedRecord } from "../_shared/staging-storage.ts";
import { StorageError } from "../_shared/service-errors.ts";
import { buildDevpostUrl,mapHackathon } from "./scraper-io.ts";
import { createScraperHandler } from "./service.ts";

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
  count: () => Promise.resolve(0), reset: () => Promise.resolve(0),
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
