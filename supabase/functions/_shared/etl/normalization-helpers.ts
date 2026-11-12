import { decode } from "npm:html-entities@2.6.0";
import { type RawRecord } from "./schema.ts";


export const object = (v: unknown): v is RawRecord => !!v && typeof v === "object" && !Array.isArray(v);

export const first = (r: RawRecord, ...keys: string[]): string | null => {
  for (const key of keys) {
    const v = r[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return null;
};

export const stamp = (v: unknown): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

export const dateOnly = (v: unknown): unknown => stamp(v)?.slice(0, 10) ?? v;

export const sourceKind = (url: string) => /faq|rules/i.test(url) ? "rules_faq"
  : /devpost\.com|register|submission|signup|apply/i.test(url) ? "registration_page" : "official_site";

export const textContent = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ").trim();

export const now = () => new Date().toISOString();

export function contributions(event: { event_name: string; primary_researcher_id: number | null; verifier_id: number | null }) {
  return [
    ...(event.primary_researcher_id === null ? [] : [{
      member_id: event.primary_researcher_id, contribution_type: "research",
      notes: `Imported and normalized ETL source material for ${event.event_name}.`,
    }]),
    ...(event.verifier_id === null ? [] : [{
      member_id: event.verifier_id, contribution_type: "verification",
      notes: `Reviewed imported evidence and verification signals for ${event.event_name}.`,
    }]),
  ];
}

export function rename(value: unknown, map: Record<string, string>) {
  return typeof value === "string" ? map[value.trim().toLowerCase()] ?? value : value;
}

export type Candidate = { source_type: string; url: string };

export const uniqueUrls = (items: Candidate[], limit: number) => {
  const seen = new Set<string>();
  return items.filter((v) => {
    if (seen.has(v.url)) return false;
    seen.add(v.url);
    return true;
  }).slice(0, limit);
};

export function findMatchingSourceEntry(raw: RawRecord, payload: unknown): RawRecord | undefined {
  if (!object(payload) || !Array.isArray(payload.hackathons)) return undefined;
  const url = first(raw, "url", "official_website", "event_url");
  const title = first(raw, "title", "event_name", "name");
  return payload.hackathons.find((entry: unknown): entry is RawRecord =>
    object(entry) && (
      raw.id !== null && raw.id !== undefined && entry.id !== null && entry.id !== undefined &&
        String(entry.id).trim() === String(raw.id).trim() ||
      !!url && first(entry, "url") === url ||
      !!title && first(entry, "title") === title
    ));
}
