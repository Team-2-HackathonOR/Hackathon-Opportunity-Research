import type { ScrapedHackathon } from "./models.ts";

const months = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function submissionEndDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\u00a0|&nbsp;/g, " ").replace(/[\u2013\u2014]|&ndash;|&mdash;/g, "-")
    .replace(/\s+/g, " ").trim();
  const iso = text.match(/^(?:\d{4}-\d{2}-\d{2}\s+-\s+)?(\d{4}-\d{2}-\d{2})$/);
  if (iso) return validDay(iso[1]) ? iso[1] : null;
  const end = text.match(/(?:^|-\s*)(?:([a-z]+)\.?\s+)?(\d{1,2})(?:,\s*|\s+)(\d{4})$/i);
  if (!end) return null;
  const monthName = end[1] ?? text.match(/^([a-z]+)\.?\s+\d{1,2}(?:,\s*\d{4})?\s*-/i)?.[1];
  if (!monthName) return null;
  const normalized = monthName.toLowerCase();
  const month = months.findIndex((name, index) =>
    normalized === name || normalized === name.slice(0, 3) || (index === 8 && normalized === "sept"));
  if (month < 0) return null;
  const day = `${end[3]}-${String(month + 1).padStart(2, "0")}-${end[2].padStart(2, "0")}`;
  return validDay(day) ? day : null;
}

export function filterNewHackathons(records: ScrapedHackathon[], fetchedAt: string) {
  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp)) throw new Error("Scraper cutoff requires a valid scrape timestamp.");
  const cutoffDate = new Date(timestamp).toISOString().slice(0, 10);
  if (!validDay(cutoffDate)) throw new Error("Scraper cutoff requires a valid UTC calendar day.");
  let expiredDiscarded = 0;
  let unknownDatesRetained = 0;
  const hackathons = records.filter((record) => {
    const end = submissionEndDate(record.submissionPeriod);
    if (end === null) { unknownDatesRetained++; return true; }
    if (end < cutoffDate) { expiredDiscarded++; return false; }
    return true;
  });
  return { hackathons, dateFilter: { cutoffDate, sourceRecords: records.length, expiredDiscarded, unknownDatesRetained } };
}
