import { bigint, boolean, date, text } from "drizzle-orm/pg-core";

import { research, tz } from "./base.js";

export const applyNowQueue = research
  .view("v_apply_now_queue", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    registrationLink: text("registration_link"),
    registrationDeadlineAt: tz("registration_deadline_at"),
    registrationStatus: text("registration_status"),
    shortlistedAt: tz("shortlisted_at"),
    whyPractical: text("why_practical"),
    stillNeedsVerification: text("still_needs_verification"),
  })
  .existing();

export const codyzaShortlist = research
  .view("v_codyza_shortlist", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    operationalStatus: text("operational_status"),
    evidenceConfidence: text("evidence_confidence"),
    registrationStatus: text("registration_status"),
    registrationDeadlineAt: tz("registration_deadline_at"),
    queueType: text("queue_type"),
    confirmedEligibility: boolean("confirmed_eligibility"),
    whyPractical: text("why_practical"),
    stillNeedsVerification: text("still_needs_verification"),
  })
  .existing();

export const prepareBeforeOpeningQueue = research
  .view("v_prepare_before_opening_queue", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    officialWebsite: text("official_website"),
    registrationStatus: text("registration_status"),
    shortlistedAt: tz("shortlisted_at"),
    whyPractical: text("why_practical"),
    stillNeedsVerification: text("still_needs_verification"),
  })
  .existing();

export const travelSupportedOpportunities = research
  .view("v_travel_supported_opportunities", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    city: text("city"),
    stateRegion: text("state_region"),
    country: text("country"),
    travelSupport: text("travel_support"),
    lodgingSupport: text("lodging_support"),
    reimbursementConditions: text("reimbursement_conditions"),
    officialWebsite: text("official_website"),
  })
  .existing();

export const virtualHybridOpportunities = research
  .view("v_virtual_hybrid_opportunities", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    format: text("format"),
    eventStartDate: date("event_start_date"),
    eventEndDate: date("event_end_date"),
    registrationLink: text("registration_link"),
    officialWebsite: text("official_website"),
  })
  .existing();

export const upcomingMonitoringList = research
  .view("v_upcoming_monitoring_list", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    organizerName: text("organizer_name"),
    officialWebsite: text("official_website"),
    registrationStatus: text("registration_status"),
    operationalStatus: text("operational_status"),
    lastVerifiedAt: tz("last_verified_at"),
    unresolvedQuestions: text("unresolved_questions"),
    nextAction: text("next_action"),
  })
  .existing();

const deadlineViewColumns = {
  eventId: bigint("event_id", { mode: "number" }),
  eventName: text("event_name"),
  milestoneType: text("milestone_type"),
  milestoneName: text("milestone_name"),
  dueAt: tz("due_at"),
  timezoneName: text("timezone_name"),
  registrationLink: text("registration_link"),
  officialWebsite: text("official_website"),
};

export const deadlinesNext7Days = research.view("v_deadlines_next_7_days", deadlineViewColumns).existing();
export const deadlinesNext30Days = research.view("v_deadlines_next_30_days", deadlineViewColumns).existing();

export const sourceEvidenceAppendix = research
  .view("v_source_evidence_appendix", {
    eventId: bigint("event_id", { mode: "number" }),
    eventName: text("event_name"),
    sourceType: text("source_type"),
    sourceTitle: text("source_title"),
    sourceUrl: text("source_url"),
    isPrimarySource: boolean("is_primary_source"),
    verifiedOn: tz("verified_on"),
    notes: text("notes"),
  })
  .existing();
