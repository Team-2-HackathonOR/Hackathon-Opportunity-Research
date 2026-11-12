import { research } from "./base.js";

export const eventFormatEnum = research.enum("event_format", [
  "in_person",
  "virtual",
  "hybrid",
  "unknown",
]);

export const operationalStatusEnum = research.enum("operational_status", [
  "verified_apply_now",
  "verified_registration_upcoming",
  "monitor",
  "needs_confirmation",
  "not_eligible",
  "closed_expired",
  "rejected_unreliable",
]);

export const evidenceConfidenceEnum = research.enum("evidence_confidence", [
  "high",
  "medium",
  "low",
]);

export const supportStatusEnum = research.enum("support_status", [
  "provided",
  "partially_reimbursed",
  "application_based",
  "not_provided",
  "not_confirmed",
]);

export const sourceKindEnum = research.enum("source_kind", [
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

export const trackKindEnum = research.enum("track_kind", [
  "theme",
  "track",
  "sponsor_challenge",
  "required_technology",
  "api_platform_requirement",
]);

export const benefitTypeEnum = research.enum("benefit_type", [
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

export const milestoneTypeEnum = research.enum("milestone_type", [
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

export const queueTypeEnum = research.enum("queue_type", [
  "apply_now",
  "prepare_before_opening",
]);

export const applicationMaterialTypeEnum = research.enum("application_material_type", [
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

export const readinessStatusEnum = research.enum("readiness_status", [
  "not_started",
  "in_progress",
  "ready",
  "submitted",
  "not_applicable",
]);

export const responseStatusEnum = research.enum("response_status", [
  "draft",
  "sent",
  "responded",
  "closed",
  "no_response",
]);

export const verificationResultEnum = research.enum("verification_result", [
  "confirmed",
  "partially_confirmed",
  "needs_follow_up",
  "conflicting",
]);

export const contributionTypeEnum = research.enum("contribution_type", [
  "discovery",
  "research",
  "verification",
  "shortlist",
  "follow_up",
  "deadline_tracking",
  "qa",
  "other",
]);
