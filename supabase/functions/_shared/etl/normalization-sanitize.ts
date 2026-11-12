import { dateOnly,first,object,rename,stamp } from './normalization-helpers.ts';
import { benefitKinds,trackKinds,type RawRecord } from "./schema.ts";

export function sanitizeAiPayload(input: RawRecord): RawRecord {
  const result = { ...input };
  for (const field of ["event_start_date", "event_end_date", "acceptance_date"]) result[field] = dateOnly(result[field]);
  const mapItems = (field: string, fn: (item: RawRecord) => RawRecord | null) => {
    if (Array.isArray(result[field])) result[field] = result[field].map((v) => object(v) ? fn({ ...v }) : v).filter((v) => v !== null);
  };
  const queueMap = { apply: "apply_now", open: "apply_now", registration_open: "apply_now", prepare: "prepare_before_opening", upcoming: "prepare_before_opening", pre_open: "prepare_before_opening" };
  const fallbackText = (r: RawRecord, key: string, ...keys: string[]) => {
    if (typeof r[key] !== "string" || !r[key].trim()) r[key] = first(r, ...keys);
  };
  mapItems("tracks", (r) => {
    if (typeof r.track_type !== "string") return r;
    const normalized = r.track_type.trim().toLowerCase();
    const mapped = rename(normalized, { primary: "theme", primary_track: "theme", mini_challenge: "sponsor_challenge", challenge: "sponsor_challenge", technology: "required_technology", platform_requirement: "api_platform_requirement" });
    r.track_type = trackKinds.some((v) => v === mapped) ? mapped : /challenge/.test(normalized) ? "sponsor_challenge"
      : /technology/.test(normalized) ? "required_technology" : /api|platform/.test(normalized) ? "api_platform_requirement"
      : /theme|primary/.test(normalized) ? "theme" : "track";
    return r;
  });
  mapItems("benefits", (r) => {
    if (typeof r.benefit_type === "string") {
      const mapped = rename(r.benefit_type.trim().toLowerCase(), {
        cash_prize: "prize", recognition: "career_exposure", career: "career_exposure", participant: "participant_benefit", mentorship: "mentor",
      });
      r.benefit_type = benefitKinds.some((v) => v === mapped) ? mapped : "other";
    }
    return r;
  });
  mapItems("sources", (r) => ({ ...r, captured_on: dateOnly(r.captured_on) }));
  mapItems("milestones", (r) => {
    fallbackText(r, "milestone_name", "title", "name", "description", "notes");
    r.milestone_type = rename(r.milestone_type, { submission_period: "registration_open", submission_window: "registration_open", submission_deadline: "registration_deadline", apply_deadline: "registration_deadline" });
    if (!r.milestone_type && typeof r.milestone_name === "string") {
      const n = r.milestone_name.toLowerCase();
      r.milestone_type = /registration/.test(n) && /open/.test(n) ? "registration_open"
        : /submission|apply|deadline|register by/.test(n) ? "registration_deadline"
        : /travel grant/.test(n) ? "travel_grant_deadline" : /accept/.test(n) ? "acceptance_date"
        : /confirm/.test(n) ? "confirmation_deadline" : /start|kickoff|begins/.test(n) ? "event_start"
        : /end|ends|closing ceremony/.test(n) ? "event_end" : "other";
    }
    return r;
  });
  mapItems("application_requirement_items", (r) => {
    r.queue_type = rename(r.queue_type, queueMap);
    r.requirement_type = rename(r.requirement_type, { account: "registration_account", signup: "registration_account", cv: "resume",
      portfolio: "portfolio_github", github: "portfolio_github", student_id: "student_verification", essay: "essay_questions",
      team: "team_information", idea: "project_idea", referral: "referral_invite", invite: "referral_invite",
      demo_video_requirements: "other", demo_video: "other", video: "other", post_acceptance: "post_acceptance_step" });
    r.status = rename(r.status, { "not started": "not_started", "in progress": "in_progress", "n/a": "not_applicable" });
    if (r.due_at) r.due_at = stamp(r.due_at) ?? r.due_at;
    fallbackText(r, "requirement_text", "description", "name", "title");
    if (typeof r.notes === "boolean") r.notes = r.notes ? "True" : "False";
    return r;
  });
  if (object(result.shortlist_entry)) {
    const r = { ...result.shortlist_entry, queue_type: rename(result.shortlist_entry.queue_type, queueMap) };
    fallbackText(r, "why_practical", "technical_relevance");
    result.shortlist_entry = r;
  }
  mapItems("verifications", (r) => {
    if (r.checked_by_member_id === null || r.checked_by_member_id === undefined || r.checked_by_member_id === "") {
      r.checked_by_member_id = typeof result.verifier_id === "number" ? result.verifier_id : result.primary_researcher_id;
    }
    if (r.checked_by_member_id === null || r.checked_by_member_id === undefined || r.checked_by_member_id === "") return null;
    if (r.checked_at) r.checked_at = stamp(r.checked_at) ?? r.checked_at;
    r.result = rename(r.result, { confirm: "confirmed", "partially confirmed": "partially_confirmed", partial: "partially_confirmed",
      "needs follow up": "needs_follow_up", follow_up: "needs_follow_up", conflict: "conflicting" });
    fallbackText(r, "verification_scope", "scope", "title", "notes");
    if (typeof r.notes === "boolean") r.notes = r.notes ? "True" : "False";
    return r;
  });
  return result;
}
