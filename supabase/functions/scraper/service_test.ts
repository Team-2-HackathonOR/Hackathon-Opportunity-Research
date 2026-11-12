import { MongoClient } from "npm:mongodb@6.21.0";
import type { DevpostHackathon } from "../_shared/scraper/models.ts";
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

Deno.test("scraper preserves source mapping and strips only control query parameters", () => {
  const mapped = mapHackathon(sample);
  assert(mapped.prizeAmount === "$100" && mapped.thumbnailUrl === "https://images.test/image", "Mapping changed.");
  assert(mapped.themes[0] === "AI" && mapped.location === "Unknown", "Missing mapped category or location.");
  const url = new URL(buildDevpostUrl(new URLSearchParams("persist=true&startPage=2&maxPages=1&search=ai&search=web"), true, 2));
  assert(url.origin === "https://devpost.com" && url.searchParams.get("page") === "2", "Wrong upstream page.");
  assert(!url.searchParams.has("maxPages") && url.searchParams.getAll("search").length === 2, "Filters were not preserved.");
});

Deno.test("bounded scraper rejects unbounded work before I/O and reports exact run acknowledgement", async () => {
  const client = new MongoClient("mongodb://127.0.0.1:1");
  const collection = client.db("fixture").collection("hackathons");
  let writes = 0;
  let timestamp: unknown;
  let pages = 0;
  Object.defineProperty(collection, "bulkWrite", { value: (operations: unknown[]) => {
    const operation = operations[0];
    if (typeof operation === "object" && operation !== null && "updateOne" in operation) {
      const update = operation.updateOne;
      if (typeof update === "object" && update !== null && "update" in update) {
        const doc = update.update;
        if (typeof doc === "object" && doc !== null && "$set" in doc) {
          const value = doc.$set;
          if (typeof value === "object" && value !== null && "fetchedAt" in value) timestamp = value.fetchedAt;
        }
      }
    }
    writes += operations.length;
    return Promise.resolve({});
  } });
  Object.defineProperty(collection, "countDocuments", { value: (filter: { fetchedAt: string }) => {
    assert(filter.fetchedAt === timestamp, "Run count queried a different timestamp.");
    return Promise.resolve(writes);
  } });
  const handler = createScraperHandler({
    collection: () => Promise.resolve(collection),
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
  assert(pages === 0 && writes === 0, "Invalid request performed I/O.");
  const fetchedAt = "2026-11-12T10:00:00.000Z";
  const response = await handler(new Request(`https://example.test${path}?startPage=1&maxPages=1`, {
    headers: { "x-pipeline-fetched-at": fetchedAt },
  }), path);
  const result = await response.json();
  assert(response.status === 200 && result.runUniqueHackathonsPersisted === 1 && result.pagesPersisted === 1, "Incorrect durable batch summary.");
  assert(timestamp === fetchedAt, "Batch did not reuse the run timestamp.");
  await client.close();
});
