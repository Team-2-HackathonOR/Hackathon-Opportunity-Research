import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, numeric, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { research, tz } from "./base.js";
import { applicationMaterialTypeEnum, benefitTypeEnum, contributionTypeEnum, milestoneTypeEnum, queueTypeEnum, readinessStatusEnum, responseStatusEnum, sourceKindEnum, trackKindEnum, verificationResultEnum } from "./enums.js";
import { events, teamMembers } from "./core.js";

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
