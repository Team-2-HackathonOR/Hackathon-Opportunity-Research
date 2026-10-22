import type { EventInsert, FollowUpInsert } from "./schema.js";
import type { EventCreateInput, EventUpdateInput } from "../schemas/hackathon.js";
import type { FollowupCreateInput, FollowupUpdateInput } from "../schemas/followup.js";

export function toApiRecord(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    out[snake] = value;
  }
  return out;
}

function fee(value: number | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.toFixed(2);
}

export function toEventInsert(payload: EventCreateInput): EventInsert {
  return {
    eventName: payload.event_name,
    organizerName: payload.organizer_name,
    hostEntity: payload.host_entity,
    officialWebsite: payload.official_website,
    registrationLink: payload.registration_link,
    rulesFaqLink: payload.rules_faq_link,
    officialDomain: payload.official_domain,
    registrationPlatform: payload.registration_platform,
    city: payload.city,
    stateRegion: payload.state_region,
    country: payload.country,
    venue: payload.venue,
    format: payload.format,
    eventStartDate: payload.event_start_date,
    eventEndDate: payload.event_end_date,
    eventTimezone: payload.event_timezone,
    registrationDeadlineAt: payload.registration_deadline_at,
    registrationStatus: payload.registration_status,
    acceptanceDate: payload.acceptance_date,
    waitlistInformation: payload.waitlist_information,
    lastVerifiedAt: payload.last_verified_at,
    studentEligibility: payload.student_eligibility,
    outsideSchoolEligibility: payload.outside_school_eligibility,
    internationalStudentWording: payload.international_student_wording,
    ageRules: payload.age_rules,
    geographicRestrictions: payload.geographic_restrictions,
    invitationRequirements: payload.invitation_requirements,
    teamSizeMin: payload.team_size_min,
    teamSizeMax: payload.team_size_max,
    soloParticipationPolicy: payload.solo_participation_policy,
    teamFormationRules: payload.team_formation_rules,
    allMembersMustRegister: payload.all_members_must_register,
    registrationFeeAmount: fee(payload.registration_fee_amount),
    registrationFeeCurrency: payload.registration_fee_currency,
    registrationFeeNotes: payload.registration_fee_notes,
    travelSupport: payload.travel_support,
    lodgingSupport: payload.lodging_support,
    mealsSupport: payload.meals_support,
    localTransportSupport: payload.local_transport_support,
    travelSupportNotes: payload.travel_support_notes,
    reimbursementConditions: payload.reimbursement_conditions,
    expensesPaidUpfront: payload.expenses_paid_upfront,
    judgingCriteria: payload.judging_criteria,
    submissionFormat: payload.submission_format,
    projectStartRules: payload.project_start_rules,
    preExistingCodePolicy: payload.pre_existing_code_policy,
    aiToolPolicy: payload.ai_tool_policy,
    openSourceRules: payload.open_source_rules,
    dataRestrictions: payload.data_restrictions,
    demoVideoRequirements: payload.demo_video_requirements,
    intellectualPropertyTerms: payload.intellectual_property_terms,
    applicationRequirements: payload.application_requirements,
    organizerContactSummary: payload.organizer_contact_summary,
    unresolvedQuestions: payload.unresolved_questions,
    legitimacyNotes: payload.legitimacy_notes,
    riskFlags: payload.risk_flags,
    operationalStatus: payload.operational_status,
    evidenceConfidence: payload.evidence_confidence,
    nextAction: payload.next_action,
    primaryResearcherId: payload.primary_researcher_id,
    verifierId: payload.verifier_id,
    duplicateOfEventId: payload.duplicate_of_event_id,
  };
}

export function toEventUpdate(patch: EventUpdateInput): Partial<EventInsert> {
  const update: Partial<EventInsert> = { updatedAt: new Date().toISOString() };
  const assign = <K extends keyof EventInsert>(key: K, value: EventInsert[K] | undefined) => {
    if (value !== undefined) update[key] = value;
  };

  assign("eventName", patch.event_name);
  assign("organizerName", patch.organizer_name);
  assign("hostEntity", patch.host_entity);
  assign("officialWebsite", patch.official_website);
  assign("registrationLink", patch.registration_link);
  assign("rulesFaqLink", patch.rules_faq_link);
  assign("officialDomain", patch.official_domain);
  assign("registrationPlatform", patch.registration_platform);
  assign("city", patch.city);
  assign("stateRegion", patch.state_region);
  assign("country", patch.country);
  assign("venue", patch.venue);
  assign("format", patch.format);
  assign("eventStartDate", patch.event_start_date);
  assign("eventEndDate", patch.event_end_date);
  assign("eventTimezone", patch.event_timezone);
  assign("registrationDeadlineAt", patch.registration_deadline_at);
  assign("registrationStatus", patch.registration_status);
  assign("acceptanceDate", patch.acceptance_date);
  assign("waitlistInformation", patch.waitlist_information);
  assign("lastVerifiedAt", patch.last_verified_at);
  assign("studentEligibility", patch.student_eligibility);
  assign("outsideSchoolEligibility", patch.outside_school_eligibility);
  assign("internationalStudentWording", patch.international_student_wording);
  assign("ageRules", patch.age_rules);
  assign("geographicRestrictions", patch.geographic_restrictions);
  assign("invitationRequirements", patch.invitation_requirements);
  assign("teamSizeMin", patch.team_size_min);
  assign("teamSizeMax", patch.team_size_max);
  assign("soloParticipationPolicy", patch.solo_participation_policy);
  assign("teamFormationRules", patch.team_formation_rules);
  assign("allMembersMustRegister", patch.all_members_must_register);
  if (patch.registration_fee_amount !== undefined) {
    update.registrationFeeAmount = fee(patch.registration_fee_amount);
  }
  assign("registrationFeeCurrency", patch.registration_fee_currency);
  assign("registrationFeeNotes", patch.registration_fee_notes);
  assign("travelSupport", patch.travel_support);
  assign("lodgingSupport", patch.lodging_support);
  assign("mealsSupport", patch.meals_support);
  assign("localTransportSupport", patch.local_transport_support);
  assign("travelSupportNotes", patch.travel_support_notes);
  assign("reimbursementConditions", patch.reimbursement_conditions);
  assign("expensesPaidUpfront", patch.expenses_paid_upfront);
  assign("judgingCriteria", patch.judging_criteria);
  assign("submissionFormat", patch.submission_format);
  assign("projectStartRules", patch.project_start_rules);
  assign("preExistingCodePolicy", patch.pre_existing_code_policy);
  assign("aiToolPolicy", patch.ai_tool_policy);
  assign("openSourceRules", patch.open_source_rules);
  assign("dataRestrictions", patch.data_restrictions);
  assign("demoVideoRequirements", patch.demo_video_requirements);
  assign("intellectualPropertyTerms", patch.intellectual_property_terms);
  assign("applicationRequirements", patch.application_requirements);
  assign("organizerContactSummary", patch.organizer_contact_summary);
  assign("unresolvedQuestions", patch.unresolved_questions);
  assign("legitimacyNotes", patch.legitimacy_notes);
  assign("riskFlags", patch.risk_flags);
  assign("operationalStatus", patch.operational_status);
  assign("evidenceConfidence", patch.evidence_confidence);
  assign("nextAction", patch.next_action);
  assign("primaryResearcherId", patch.primary_researcher_id);
  assign("verifierId", patch.verifier_id);
  assign("duplicateOfEventId", patch.duplicate_of_event_id);
  return update;
}

export function toFollowUpInsert(payload: FollowupCreateInput): FollowUpInsert {
  return {
    eventId: payload.event_id,
    questionText: payload.question_text,
    contactChannel: payload.contact_channel,
    contactTarget: payload.contact_target,
    sentAt: payload.sent_at,
    assignedMemberId: payload.assigned_member_id,
    responseStatus: payload.response_status,
    confirmedAnswer: payload.confirmed_answer,
    answeredAt: payload.answered_at,
    evidenceSourceId: payload.evidence_source_id,
    notes: payload.notes,
  };
}

export function toFollowUpUpdate(patch: FollowupUpdateInput): Partial<FollowUpInsert> {
  const update: Partial<FollowUpInsert> = {};
  if (patch.event_id !== undefined) update.eventId = patch.event_id;
  if (patch.question_text !== undefined) update.questionText = patch.question_text;
  if (patch.contact_channel !== undefined) update.contactChannel = patch.contact_channel;
  if (patch.contact_target !== undefined) update.contactTarget = patch.contact_target;
  if (patch.sent_at !== undefined) update.sentAt = patch.sent_at;
  if (patch.assigned_member_id !== undefined) update.assignedMemberId = patch.assigned_member_id;
  if (patch.response_status !== undefined) update.responseStatus = patch.response_status;
  if (patch.confirmed_answer !== undefined) update.confirmedAnswer = patch.confirmed_answer;
  if (patch.answered_at !== undefined) update.answeredAt = patch.answered_at;
  if (patch.evidence_source_id !== undefined) update.evidenceSourceId = patch.evidence_source_id;
  if (patch.notes !== undefined) update.notes = patch.notes;
  return update;
}
