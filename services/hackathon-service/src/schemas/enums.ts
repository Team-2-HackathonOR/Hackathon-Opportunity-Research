import { z } from "zod";

export const eventFormatSchema = z.enum(["in_person", "virtual", "hybrid", "unknown"]);
export const operationalStatusSchema = z.enum([
  "verified_apply_now",
  "verified_registration_upcoming",
  "monitor",
  "needs_confirmation",
  "not_eligible",
  "closed_expired",
  "rejected_unreliable",
]);
export const evidenceConfidenceSchema = z.enum(["high", "medium", "low"]);
export const supportStatusSchema = z.enum([
  "provided",
  "partially_reimbursed",
  "application_based",
  "not_provided",
  "not_confirmed",
]);
export const sourceKindSchema = z.enum([
  "official_site",
  "registration_page",
  "rules_faq",
  "organizer_page",
  "official_social",
  "directory",
  "email_response",
  "pdf",
  "other",
]);
export const trackKindSchema = z.enum([
  "theme",
  "track",
  "sponsor_challenge",
  "required_technology",
  "api_platform_requirement",
]);
export const benefitTypeSchema = z.enum([
  "prize",
  "sponsor_prize",
  "workshop",
  "mentor",
  "recruiter",
  "networking",
  "certificate",
  "credit",
  "incubator",
  "hardware",
  "participant_benefit",
  "career_exposure",
  "other",
]);
export const milestoneTypeSchema = z.enum([
  "registration_deadline",
  "travel_grant_deadline",
  "acceptance_date",
  "confirmation_deadline",
  "pre_event_requirement",
  "registration_open",
  "event_start",
  "event_end",
  "other",
]);
export const queueTypeSchema = z.enum(["apply_now", "prepare_before_opening"]);
export const applicationMaterialTypeSchema = z.enum([
  "registration_account",
  "resume",
  "portfolio_github",
  "student_verification",
  "essay_questions",
  "team_information",
  "project_idea",
  "referral_invite",
  "deadline",
  "post_acceptance_step",
  "other",
]);
export const readinessStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "ready",
  "submitted",
  "not_applicable",
]);
export const responseStatusSchema = z.enum(["draft", "sent", "responded", "closed", "no_response"]);
export const verificationResultSchema = z.enum([
  "confirmed",
  "partially_confirmed",
  "needs_follow_up",
  "conflicting",
]);
export const contributionTypeSchema = z.enum([
  "discovery",
  "research",
  "verification",
  "shortlist",
  "follow_up",
  "deadline_tracking",
  "qa",
  "other",
]);

export const isoDateSchema = z.string().date();
export const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO timestamp.",
});
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const memberIdSchema = z.number().int().positive();
export const feeAmountSchema = z.number().nonnegative();
