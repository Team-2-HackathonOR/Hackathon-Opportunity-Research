import { z } from "npm:zod@3.25.76";

const text = z.string().nullable().default(null);
const name = z.string().min(1);
const id = z.number().int().safe().nullable().default(null);
const bool = z.boolean().nullable().default(null);
const validDate = (s: string) => !s.startsWith("0000") && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate, "Invalid date").nullable().default(null);
const instant = z.string().refine((s) => Number.isFinite(Date.parse(s)), "Invalid timestamp").nullable().default(null);
const decimal = z.union([z.number().finite(), z.string().regex(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/)]).nullable().default(null);
const queue = z.enum(["apply_now", "prepare_before_opening"]);
const support = z.enum(["provided", "partially_reimbursed", "application_based", "not_provided", "not_confirmed"]).default("not_confirmed");
export const sourceKinds = ["official_site", "registration_page", "rules_faq", "organizer_page", "official_social", "directory", "email_response", "pdf", "other"] as const;
export const trackKinds = ["theme", "track", "sponsor_challenge", "required_technology", "api_platform_requirement"] as const;
export const benefitKinds = ["prize", "sponsor_prize", "workshop", "mentor", "recruiter", "networking", "certificate", "credit", "incubator", "hardware", "participant_benefit", "career_exposure", "other"] as const;
export const milestoneKinds = ["registration_deadline", "travel_grant_deadline", "acceptance_date", "confirmation_deadline", "pre_event_requirement", "registration_open", "event_start", "event_end", "other"] as const;

export const teamMemberSchema = z.object({ full_name: name, email: text, role_name: text, active: z.boolean().default(true) });
export const eventSchema = z.object({
  event_name: name, organizer_name: text, host_entity: text,
  official_website: text, registration_link: text, rules_faq_link: text, official_domain: text, registration_platform: text,
  city: text, state_region: text, country: text, venue: text,
  format: z.enum(["in_person", "virtual", "hybrid", "unknown"]).default("unknown"),
  event_start_date: date, event_end_date: date, event_timezone: text, registration_deadline_at: instant,
  registration_status: text, acceptance_date: date, waitlist_information: text, last_verified_at: instant,
  student_eligibility: text, outside_school_eligibility: text, international_student_wording: text,
  age_rules: text, geographic_restrictions: text, invitation_requirements: text, team_size_min: id, team_size_max: id,
  solo_participation_policy: text, team_formation_rules: text, all_members_must_register: bool,
  registration_fee_amount: decimal, registration_fee_currency: text.transform((v) => v?.toUpperCase() ?? null),
  registration_fee_notes: text, travel_support: support, lodging_support: support, meals_support: support,
  local_transport_support: support, travel_support_notes: text, reimbursement_conditions: text, expenses_paid_upfront: bool,
  judging_criteria: text, submission_format: text, project_start_rules: text, pre_existing_code_policy: text,
  ai_tool_policy: text, open_source_rules: text, data_restrictions: text, demo_video_requirements: text,
  intellectual_property_terms: text, application_requirements: text, organizer_contact_summary: text,
  unresolved_questions: text, legitimacy_notes: text, risk_flags: text,
  operational_status: z.enum(["verified_apply_now", "verified_registration_upcoming", "monitor", "needs_confirmation", "not_eligible", "closed_expired", "rejected_unreliable"]),
  evidence_confidence: z.enum(["high", "medium", "low"]),
  next_action: text, primary_researcher_id: id, verifier_id: id, duplicate_of_event_id: id,
  categories: z.array(z.object({ category_name: name, is_primary: z.boolean().default(false) })).default([]),
  tracks: z.array(z.object({ track_type: z.enum(trackKinds), track_name: name, description: text })).default([]),
  benefits: z.array(z.object({ benefit_type: z.enum(benefitKinds), title: text, description: name,
    is_guaranteed_to_all: z.boolean().default(false), award_value: text })).default([]),
  sources: z.array(z.object({ source_type: z.enum(sourceKinds), source_url: name, source_title: text,
    is_primary_source: z.boolean().default(true), captured_on: date, verified_on: instant, notes: text })).default([]),
  milestones: z.array(z.object({ milestone_type: z.enum(milestoneKinds), milestone_name: name,
    due_at: instant, timezone_name: text, is_confirmed: z.boolean().default(true), notes: text, last_verified_at: instant })).default([]),
  shortlist_entry: z.object({ queue_type: queue, shortlisted_by_member_id: id, shortlisted_at: instant,
    confirmed_eligibility: bool, expected_cost_summary: text, schedule_feasibility: text, technical_relevance: text,
    organizer_credibility: text, learning_networking_potential: text, evidence_quality_notes: text,
    why_practical: name, still_needs_verification: text }).nullable().default(null),
  application_requirement_items: z.array(z.object({ queue_type: queue,
    requirement_type: z.enum(["registration_account", "resume", "portfolio_github", "student_verification", "essay_questions", "team_information", "project_idea", "referral_invite", "deadline", "post_acceptance_step", "other"]),
    requirement_text: name, due_at: instant,
    status: z.enum(["not_started", "in_progress", "ready", "submitted", "not_applicable"]).default("not_started"),
    owner_member_id: id, notes: text })).default([]),
  organizer_follow_ups: z.array(z.object({ question_text: name, contact_channel: text, contact_target: text,
    sent_at: instant, assigned_member_id: id,
    response_status: z.enum(["draft", "sent", "responded", "closed", "no_response"]).default("draft"),
    confirmed_answer: text, answered_at: instant, evidence_source_id: id, notes: text })).default([]),
  verifications: z.array(z.object({ checked_by_member_id: z.number().int().safe(), checked_at: instant,
    verification_scope: name, result: z.enum(["confirmed", "partially_confirmed", "needs_follow_up", "conflicting"]), notes: text })).default([]),
  contributions: z.array(z.object({ member_id: z.number().int().safe(),
    contribution_type: z.enum(["discovery", "research", "verification", "shortlist", "follow_up", "deadline_tracking", "qa", "other"]),
    notes: name, hours_spent: decimal, contributed_at: instant })).default([]),
});
export type EventInput = z.infer<typeof eventSchema>;
export type RawRecord = Record<string, unknown>;

export const mongoImportSchema = z.object({
  database_name: text, collection_name: text, limit: z.number().int().min(1).max(1000).nullable().default(25),
  fetched_at: z.string().min(1).max(40).nullable().default(null), cursor_mode: z.boolean().default(false),
  after_id: z.number().int().safe().min(0).nullable().default(null),
  use_ai_normalization: z.boolean().default(true), primary_researcher_id: id, verifier_id: id,
});
