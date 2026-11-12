import { HttpError } from "../runtime.ts";
import { contributions,first,now,object,sourceKind,stamp } from './normalization-helpers.ts';
import { eventSchema,type EventInput,type RawRecord } from "./schema.ts";

export function buildBaseEvent(raw: RawRecord, primary_researcher_id: number | null, verifier_id: number | null): EventInput {
  const event_name = first(raw, "event_name", "title", "name");
  if (!event_name) throw new HttpError(422, "Record is missing an event name/title.");
  const official_website = first(raw, "official_website", "url", "event_url");
  const registration_link = first(raw, "registration_link", "startSubmissionUrl", "registration_url", "url");
  const rules_faq_link = first(raw, "rules_faq_link", "rules_url", "faq_url");
  const rawLocation = raw.location || raw.venue || raw.displayed_location;
  const location = typeof rawLocation === "string" ? rawLocation.trim() : object(rawLocation) ? first(rawLocation, "location") : null;
  const parts = location?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const format = !location ? "unknown" : /virtual|online|remote/i.test(location) ? "virtual" : /hybrid/i.test(location) ? "hybrid" : "in_person";
  const candidates = raw.categories || raw.themes || [];
  const names = [...new Set((Array.isArray(candidates) ? candidates : []).map((item) =>
    typeof item === "string" ? item.trim() : object(item) ? first(item, "category_name", "name") : null).filter((v): v is string => !!v))];
  const status = first(raw, "registration_status", "status", "open_state");
  const operational_status = /closed|ended|expired/i.test(status ?? "") ? "closed_expired"
    : /open|accepting|live/i.test(status ?? "") ? "verified_apply_now"
    : /upcoming|soon|opens/i.test(status ?? "") ? "verified_registration_upcoming" : "monitor";
  const sources: RawRecord[] = [];
  const seen = new Set<string>();
  const addSource = (url: string | null, source_type: string, source_title: string, is_primary_source: boolean) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ source_type, source_url: url, source_title, is_primary_source, verified_on: now() });
  };
  addSource(official_website, official_website ? sourceKind(official_website) : "official_site", "Imported source URL", true);
  addSource(first(raw, "registration_link", "startSubmissionUrl", "registration_url"), "registration_page", "Registration page", false);
  addSource(rules_faq_link, "rules_faq", "Rules or FAQ page", false);
  addSource(first(raw, "sourceUrl", "source_url"), "directory", "Source listing", false);
  const prize = first(raw, "prizeAmount", "prize_amount");
  return eventSchema.parse({
    event_name, organizer_name: first(raw, "organizer_name", "organization", "organization_name", "organizer"),
    host_entity: first(raw, "host_entity", "host"), official_website, registration_link, rules_faq_link,
    official_domain: official_website?.match(/^https?:\/\/([^/]+)/)?.[1] ?? null,
    registration_platform: first(raw, "registration_platform", "platform"),
    city: format === "in_person" ? parts[0] ?? null : null,
    state_region: format === "in_person" ? parts[1] ?? null : null,
    country: format === "in_person" ? parts[2] ?? null : null, venue: location, format,
    registration_status: status, last_verified_at: stamp(raw.updatedAt || raw.fetchedAt) ?? now(),
    registration_fee_notes: first(raw, "registration_fee_notes", "price"),
    pre_existing_code_policy: first(raw, "pre_existing_code_policy"), ai_tool_policy: first(raw, "ai_tool_policy"),
    application_requirements: first(raw, "application_requirements"),
    unresolved_questions: "Imported from source data. Primary-source verification is still required.",
    legitimacy_notes: "Imported lead requires official verification before recommendation.",
    operational_status, evidence_confidence: "low",
    next_action: "Verify official site, dates, eligibility, and support details from primary sources.",
    primary_researcher_id, verifier_id,
    categories: names.map((category_name, index) => ({ category_name, is_primary: index === 0 })),
    tracks: names.map((track_name) => ({ track_type: "theme", track_name })),
    benefits: prize ? [{ benefit_type: "prize", title: "Prize Pool", description: `Listed prize pool: ${prize}`, award_value: prize }] : [],
    sources, contributions: contributions({ event_name, primary_researcher_id, verifier_id }),
  });
}
