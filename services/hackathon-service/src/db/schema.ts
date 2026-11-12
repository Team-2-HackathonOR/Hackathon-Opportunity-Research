import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const research = pgSchema("hackathon_research");

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

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const teamMembers = research.table("team_members", {
  memberId: bigint("member_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").unique(),
  roleName: text("role_name"),
  active: boolean("active").notNull().default(true),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const events = research.table(
  "events",
  {
    eventId: bigint("event_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventName: text("event_name").notNull(),
    organizerName: text("organizer_name"),
    hostEntity: text("host_entity"),
    officialWebsite: text("official_website"),
    registrationLink: text("registration_link"),
    rulesFaqLink: text("rules_faq_link"),
    officialDomain: text("official_domain"),
    registrationPlatform: text("registration_platform"),
    city: text("city"),
    stateRegion: text("state_region"),
    country: text("country"),
    venue: text("venue"),
    format: eventFormatEnum("format").notNull().default("unknown"),
    eventStartDate: date("event_start_date"),
    eventEndDate: date("event_end_date"),
    eventTimezone: text("event_timezone"),
    registrationDeadlineAt: tz("registration_deadline_at"),
    registrationStatus: text("registration_status"),
    acceptanceDate: date("acceptance_date"),
    waitlistInformation: text("waitlist_information"),
    lastVerifiedAt: tz("last_verified_at").notNull().defaultNow(),
    studentEligibility: text("student_eligibility"),
    outsideSchoolEligibility: text("outside_school_eligibility"),
    internationalStudentWording: text("international_student_wording"),
    ageRules: text("age_rules"),
    geographicRestrictions: text("geographic_restrictions"),
    invitationRequirements: text("invitation_requirements"),
    teamSizeMin: smallint("team_size_min"),
    teamSizeMax: smallint("team_size_max"),
    soloParticipationPolicy: text("solo_participation_policy"),
    teamFormationRules: text("team_formation_rules"),
    allMembersMustRegister: boolean("all_members_must_register"),
    registrationFeeAmount: numeric("registration_fee_amount", { precision: 10, scale: 2 }),
    registrationFeeCurrency: char("registration_fee_currency", { length: 3 }),
    registrationFeeNotes: text("registration_fee_notes"),
    travelSupport: supportStatusEnum("travel_support").notNull().default("not_confirmed"),
    lodgingSupport: supportStatusEnum("lodging_support").notNull().default("not_confirmed"),
    mealsSupport: supportStatusEnum("meals_support").notNull().default("not_confirmed"),
    localTransportSupport: supportStatusEnum("local_transport_support").notNull().default("not_confirmed"),
    travelSupportNotes: text("travel_support_notes"),
    reimbursementConditions: text("reimbursement_conditions"),
    expensesPaidUpfront: boolean("expenses_paid_upfront"),
    judgingCriteria: text("judging_criteria"),
    submissionFormat: text("submission_format"),
    projectStartRules: text("project_start_rules"),
    preExistingCodePolicy: text("pre_existing_code_policy"),
    aiToolPolicy: text("ai_tool_policy"),
    openSourceRules: text("open_source_rules"),
    dataRestrictions: text("data_restrictions"),
    demoVideoRequirements: text("demo_video_requirements"),
    intellectualPropertyTerms: text("intellectual_property_terms"),
    applicationRequirements: text("application_requirements"),
    organizerContactSummary: text("organizer_contact_summary"),
    unresolvedQuestions: text("unresolved_questions"),
    legitimacyNotes: text("legitimacy_notes"),
    riskFlags: text("risk_flags"),
    operationalStatus: operationalStatusEnum("operational_status").notNull(),
    evidenceConfidence: evidenceConfidenceEnum("evidence_confidence").notNull(),
    nextAction: text("next_action"),
    primaryResearcherId: bigint("primary_researcher_id", { mode: "number" }).references(
      () => teamMembers.memberId,
      { onDelete: "set null" },
    ),
    verifierId: bigint("verifier_id", { mode: "number" }).references(() => teamMembers.memberId, {
      onDelete: "set null",
    }),
    duplicateOfEventId: bigint("duplicate_of_event_id", { mode: "number" }).references(
      (): AnyPgColumn => events.eventId,
      { onDelete: "set null" },
    ),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_events_master_identity").on(
      table.eventName,
      sql`coalesce(${table.eventStartDate}, date '1900-01-01')`,
      sql`coalesce(${table.city}, '')`,
      sql`coalesce(${table.country}, '')`,
    ),
    index("ix_events_status").on(table.operationalStatus),
    index("ix_events_confidence").on(table.evidenceConfidence),
    index("ix_events_format").on(table.format),
    index("ix_events_deadline").on(table.registrationDeadlineAt),
    check(
      "chk_event_dates",
      sql`${table.eventEndDate} is null or ${table.eventStartDate} is null or ${table.eventEndDate} >= ${table.eventStartDate}`,
    ),
    check(
      "chk_team_size",
      sql`${table.teamSizeMin} is null or ${table.teamSizeMax} is null or ${table.teamSizeMax} >= ${table.teamSizeMin}`,
    ),
    check(
      "chk_fee_amount",
      sql`${table.registrationFeeAmount} is null or ${table.registrationFeeAmount} >= 0`,
    ),
    check(
      "chk_currency_code",
      sql`${table.registrationFeeCurrency} is null or ${table.registrationFeeCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "chk_not_self_duplicate",
      sql`${table.duplicateOfEventId} is null or ${table.duplicateOfEventId} <> ${table.eventId}`,
    ),
  ],
);

export const eventCategories = research.table("event_categories", {
  categoryId: bigint("category_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  categoryName: text("category_name").notNull().unique(),
});

export const eventCategoryAssignments = research.table(
  "event_category_assignments",
  {
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.eventId, { onDelete: "cascade" }),
    categoryId: bigint("category_id", { mode: "number" })
      .notNull()
      .references(() => eventCategories.categoryId, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.categoryId] })],
);

export const eventTracks = research.table("event_tracks", {
  trackId: bigint("track_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  eventId: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => events.eventId, { onDelete: "cascade" }),
  trackType: trackKindEnum("track_type").notNull(),
  trackName: text("track_name").notNull(),
  description: text("description"),
});

export const eventBenefits = research.table("event_benefits", {
  benefitId: bigint("benefit_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  eventId: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => events.eventId, { onDelete: "cascade" }),
  benefitType: benefitTypeEnum("benefit_type").notNull(),
  title: text("title"),
  description: text("description").notNull(),
  isGuaranteedToAll: boolean("is_guaranteed_to_all").notNull().default(false),
  awardValue: text("award_value"),
});

export const eventSources = research.table(
  "event_sources",
  {
    sourceId: bigint("source_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.eventId, { onDelete: "cascade" }),
    sourceType: sourceKindEnum("source_type").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title"),
    isPrimarySource: boolean("is_primary_source").notNull().default(true),
    capturedOn: date("captured_on"),
    verifiedOn: tz("verified_on").notNull().defaultNow(),
    notes: text("notes"),
  },
  (table) => [uniqueIndex("uq_event_source").on(table.eventId, table.sourceUrl)],
);

export const eventMilestones = research.table(
  "event_milestones",
  {
    milestoneId: bigint("milestone_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.eventId, { onDelete: "cascade" }),
    milestoneType: milestoneTypeEnum("milestone_type").notNull(),
    milestoneName: text("milestone_name").notNull(),
    dueAt: tz("due_at"),
    timezoneName: text("timezone_name"),
    isConfirmed: boolean("is_confirmed").notNull().default(true),
    notes: text("notes"),
    lastVerifiedAt: tz("last_verified_at").notNull().defaultNow(),
  },
  (table) => [index("ix_event_milestones_due_at").on(table.dueAt)],
);

export const shortlistEntries = research.table(
  "shortlist_entries",
  {
    eventId: bigint("event_id", { mode: "number" })
      .primaryKey()
      .references(() => events.eventId, { onDelete: "cascade" }),
    shortlistedAt: tz("shortlisted_at").notNull().defaultNow(),
    shortlistedByMemberId: bigint("shortlisted_by_member_id", { mode: "number" }).references(
      () => teamMembers.memberId,
      { onDelete: "set null" },
    ),
    queueType: queueTypeEnum("queue_type").notNull(),
    confirmedEligibility: boolean("confirmed_eligibility"),
    expectedCostSummary: text("expected_cost_summary"),
    scheduleFeasibility: text("schedule_feasibility"),
    technicalRelevance: text("technical_relevance"),
    organizerCredibility: text("organizer_credibility"),
    learningNetworkingPotential: text("learning_networking_potential"),
    evidenceQualityNotes: text("evidence_quality_notes"),
    whyPractical: text("why_practical").notNull(),
    stillNeedsVerification: text("still_needs_verification"),
  },
  (table) => [index("ix_shortlist_queue").on(table.queueType)],
);

export const applicationRequirements = research.table(
  "application_requirements",
  {
    requirementId: bigint("requirement_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.eventId, { onDelete: "cascade" }),
    queueType: queueTypeEnum("queue_type").notNull(),
    requirementType: applicationMaterialTypeEnum("requirement_type").notNull(),
    requirementText: text("requirement_text").notNull(),
    dueAt: tz("due_at"),
    status: readinessStatusEnum("status").notNull().default("not_started"),
    ownerMemberId: bigint("owner_member_id", { mode: "number" }).references(() => teamMembers.memberId, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (table) => [index("ix_application_requirements_status").on(table.status)],
);

export const organizerFollowUps = research.table(
  "organizer_follow_ups",
  {
    followUpId: bigint("follow_up_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.eventId, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    contactChannel: text("contact_channel"),
    contactTarget: text("contact_target"),
    sentAt: tz("sent_at"),
    assignedMemberId: bigint("assigned_member_id", { mode: "number" }).references(
      () => teamMembers.memberId,
      { onDelete: "set null" },
    ),
    responseStatus: responseStatusEnum("response_status").notNull().default("draft"),
    confirmedAnswer: text("confirmed_answer"),
    answeredAt: tz("answered_at"),
    evidenceSourceId: bigint("evidence_source_id", { mode: "number" }).references(
      () => eventSources.sourceId,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
  },
  (table) => [index("ix_follow_ups_status").on(table.responseStatus)],
);

export const eventVerifications = research.table("event_verifications", {
  verificationId: bigint("verification_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  eventId: bigint("event_id", { mode: "number" })
    .notNull()
    .references(() => events.eventId, { onDelete: "cascade" }),
  checkedByMemberId: bigint("checked_by_member_id", { mode: "number" })
    .notNull()
    .references(() => teamMembers.memberId, { onDelete: "restrict" }),
  checkedAt: tz("checked_at").notNull().defaultNow(),
  verificationScope: text("verification_scope").notNull(),
  result: verificationResultEnum("result").notNull(),
  notes: text("notes"),
});

export const contributionLog = research.table(
  "contribution_log",
  {
    contributionId: bigint("contribution_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    memberId: bigint("member_id", { mode: "number" })
      .notNull()
      .references(() => teamMembers.memberId, { onDelete: "restrict" }),
    eventId: bigint("event_id", { mode: "number" }).references(() => events.eventId, { onDelete: "set null" }),
    contributionType: contributionTypeEnum("contribution_type").notNull(),
    notes: text("notes").notNull(),
    hoursSpent: numeric("hours_spent", { precision: 5, scale: 2 }),
    contributedAt: tz("contributed_at").notNull().defaultNow(),
  },
  (table) => [
    check("chk_hours_spent", sql`${table.hoursSpent} is null or ${table.hoursSpent} >= 0`),
  ],
);

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

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;
export type FollowUpRow = typeof organizerFollowUps.$inferSelect;
export type FollowUpInsert = typeof organizerFollowUps.$inferInsert;
