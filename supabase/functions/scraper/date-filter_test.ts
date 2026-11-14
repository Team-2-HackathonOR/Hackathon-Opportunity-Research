import { createScraperHandler } from "./service.ts";
import { mapHackathon } from "./scraper-io.ts";
import type { DevpostHackathon } from "../_shared/scraper/models.ts";
import type { StagedRecord, StagingStore } from "../_shared/staging-storage.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
const sample: DevpostHackathon = {
  id: 1, title: "Test", open_state: "open", thumbnail_url: "//images.test/image",
  url: "https://event.test", time_left_to_submission: "10 days", submission_period_dates: "",
  prize_amount: "$100", prizes_counts: { cash: 1, other: 0 }, registrations_count: 10,
  featured: false, organization_name: "Test Organizer", winners_announced: false,
  submission_gallery_url: "https://event.test/gallery", start_a_submission_url: "https://event.test/register",
  invite_only: false, managed_by_devpost_badge: true,
};
const emptyStore: StagingStore = {
  persist: () => Promise.resolve(), read: () => Promise.resolve([]), count: () => Promise.resolve(0),
  ids: () => Promise.resolve(new Set()), reset: () => Promise.resolve({ deletedRecords: 0, hasMore: false }),
};
function handler(records: DevpostHackathon[], store = emptyStore, now = "2026-11-13T12:00:00.000Z") {
  return createScraperHandler({
    store, now: () => now,
    page: () => Promise.resolve({ ok: true, statusCode: 200, body: { hackathons: records, meta: { total_pages: 2 } } }),
    analyze: (_payload, requestedPage) => Promise.resolve({
      analysisEngine: "deterministic", requestedPage, hackathonsOnPage: records.length, totalCount: records.length * 2,
      perPage: records.length, totalPages: 2, hasMorePages: requestedPage < 2, canFetchAllPages: true,
      confidence: "high", signals: [], recommendation: "Continue.",
    }),
  });
}

Deno.test("new scrape results exclude confirmed expired dates but retain ongoing, future and uncertain dates", async () => {
  const periods = [
    "Jan 01 - Dec 31, 2011", "Nov 01 - Nov 12, 2026", "Nov 01 - 13, 2026",
    "Oct 30 - Dec 04, 2026", "Dec 15, 2026 - Jan 16, 2027", "November",
    "Feb 01 - Feb 30, 2026", "Nov 10 \u2013 12, 2026", "November 13, 2026",
    "2026-11-12", "2026-11-01 - 2026-11-13", "Feb 01 - Feb 29, 2025",
    "Nov 12 - Dec 01", "",
  ];
  const records = periods.map((submission_period_dates, index) => ({ ...sample, id: index + 1, submission_period_dates }));
  const response = await handler(records)(new Request("https://example.test/hackathons"), "/hackathons");
  const result = await response.json();
  assert(response.status === 200 && result.hackathons.map((v: { id: number }) => v.id).join() === "3,4,5,6,7,9,11,12,13,14",
    "Confirmed expired events were retained or eligible/uncertain dates were discarded.");
  assert(result.total === 10 && result.dateFilter.expiredDiscarded === 4 && result.dateFilter.unknownDatesRetained === 5,
    "Accepted, expired or uncertain counts are inaccurate.");
  assert(result.dateFilter.cutoffDate === "2026-11-13" && result.dateFilter.sourceRecords === 14,
    "Filter lost its UTC cutoff or original page count.");
  assert(result.paginationAnalysis.hackathonsOnPage === 14 && result.paginationAnalysis.totalPages === 2,
    "Filtering changed source pagination.");
});

Deno.test("bounded persistence filters before writes using the original run day even after midnight", async () => {
  let written: StagedRecord[] = [];
  const records = [
    { ...sample, id: 1, submission_period_dates: "Nov 01 - Nov 13, 2026" },
    { ...sample, id: 2, submission_period_dates: "Jan 01 - Dec 31, 2011" },
    { ...sample, id: 3, submission_period_dates: "Unknown" },
  ];
  const store: StagingStore = { ...emptyStore,
    persist: (values) => { written = values; return Promise.resolve(); },
    count: () => Promise.resolve(written.length),
  };
  const path = "/hackathons/persist-all";
  const fetchedAt = "2026-11-13T23:59:59.000Z";
  const response = await handler(records, store, "2026-11-14T00:05:00.000Z")(new Request(
    `https://example.test${path}?startPage=1&maxPages=1`, { headers: { "x-pipeline-fetched-at": fetchedAt } },
  ), path);
  const result = await response.json();
  assert(written.map((v) => v.id).join() === "1,3", "Expired records reached Storage or cutoff drifted after midnight.");
  assert(written.every((v) => v.fetchedAt === fetchedAt), "Run provenance changed.");
  assert(result.runUniqueHackathonsPersisted === 2 && result.hackathonsPersisted === 2,
    "Durable counts include discarded records.");
  assert(result.dateFilter.cutoffDate === "2026-11-13" && result.dateFilter.unknownDatesRetained === 1,
    "Run cutoff or unknown-date acknowledgement was lost.");
});

Deno.test("all-expired pages are acknowledged without writes and existing cache data remains untouched", async () => {
  let writes = 0;
  const old = { ...sample, submission_period_dates: "Jan 01 - Dec 31, 2011" };
  const store: StagingStore = { ...emptyStore,
    persist: () => { writes++; return Promise.resolve(); },
    read: () => Promise.resolve([{ ...mapHackathon(old), fetchedAt: "2011-01-01T00:00:00.000Z" }]),
  };
  const run = handler([old], store);
  const path = "/hackathons/persist-all";
  const response = await run(new Request(`https://example.test${path}?startPage=1&maxPages=1`, {
    headers: { "x-pipeline-fetched-at": "2026-11-13T12:00:00.000Z" },
  }), path);
  const result = await response.json();
  assert(response.status === 200 && writes === 0 && result.pagesPersisted === 1 && result.hackathonsPersisted === 0
    && result.runUniqueHackathonsPersisted === 0, "An empty eligible page was written or treated as an uncertain failure.");
  assert(result.paginationAnalysis.hasMorePages && result.dateFilter.expiredDiscarded === 1, "Empty page ended source pagination.");
  const cache = await run(new Request("https://example.test/hackathons/cache"), "/hackathons/cache");
  assert((await cache.json()).total === 1, "Filtering new scrapes removed existing cached data.");
});
