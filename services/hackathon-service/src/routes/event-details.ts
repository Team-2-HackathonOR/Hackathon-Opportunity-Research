import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import {
  applicationRequirements,
  contributionLog,
  eventBenefits,
  eventCategories,
  eventCategoryAssignments,
  eventMilestones,
  eventSources,
  eventTracks,
  eventVerifications,
  events,
  shortlistEntries,
  teamMembers,
} from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import {
  benefitCreateSchema,
  categoryAssignmentSchema,
  categoryCreateSchema,
  contributionCreateSchema,
  idParamSchema,
  milestoneCreateSchema,
  requirementCreateSchema,
  requirementUpdateSchema,
  shortlistWriteSchema,
  sourceCreateSchema,
  teamMemberCreateSchema,
  trackCreateSchema,
  verificationCreateSchema,
} from "../schemas/details.js";

async function eventExists(eventId: number): Promise<boolean> {
  const rows = await db.select({ eventId: events.eventId }).from(events).where(eq(events.eventId, eventId)).limit(1);
  return Boolean(rows[0]);
}

export const eventDetailRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/hackathons/categories", async (request, reply) => {
    try {
      const rows = await db.select().from(eventCategories).orderBy(asc(eventCategories.categoryName));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list categories.");
    }
  });

  app.post("/api/hackathons/categories", async (request, reply) => {
    const payload = categoryCreateSchema.parse(request.body);
    try {
      const [row] = await db
        .insert(eventCategories)
        .values({ categoryName: payload.category_name })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to create category.");
    }
  });

  app.get("/api/hackathons/team-members", async (request, reply) => {
    try {
      const rows = await db.select().from(teamMembers).orderBy(asc(teamMembers.fullName));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list team members.");
    }
  });

  app.post("/api/hackathons/team-members", async (request, reply) => {
    const payload = teamMemberCreateSchema.parse(request.body);
    try {
      const [row] = await db
        .insert(teamMembers)
        .values({
          fullName: payload.full_name,
          email: payload.email,
          roleName: payload.role_name,
          active: payload.active,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to create team member.");
    }
  });

  app.get("/api/hackathons/contributions", async (request, reply) => {
    try {
      const rows = await db.select().from(contributionLog).orderBy(asc(contributionLog.contributedAt));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list contributions.");
    }
  });

  app.post("/api/hackathons/contributions", async (request, reply) => {
    const payload = contributionCreateSchema.parse(request.body);
    try {
      const [row] = await db
        .insert(contributionLog)
        .values({
          memberId: payload.member_id,
          eventId: payload.event_id,
          contributionType: payload.contribution_type,
          notes: payload.notes,
          hoursSpent: payload.hours_spent == null ? payload.hours_spent : payload.hours_spent.toFixed(2),
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to record contribution.");
    }
  });

  app.get("/api/hackathons/:id/sources", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(eventSources).where(eq(eventSources.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list sources.");
    }
  });

  app.post("/api/hackathons/:id/sources", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = sourceCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventSources)
        .values({
          eventId: id,
          sourceType: payload.source_type,
          sourceUrl: payload.source_url,
          sourceTitle: payload.source_title,
          isPrimarySource: payload.is_primary_source,
          capturedOn: payload.captured_on,
          notes: payload.notes,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to add source.");
    }
  });

  app.get("/api/hackathons/:id/tracks", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(eventTracks).where(eq(eventTracks.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list tracks.");
    }
  });

  app.post("/api/hackathons/:id/tracks", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = trackCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventTracks)
        .values({
          eventId: id,
          trackType: payload.track_type,
          trackName: payload.track_name,
          description: payload.description,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to add track.");
    }
  });

  app.get("/api/hackathons/:id/benefits", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(eventBenefits).where(eq(eventBenefits.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list benefits.");
    }
  });

  app.post("/api/hackathons/:id/benefits", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = benefitCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventBenefits)
        .values({
          eventId: id,
          benefitType: payload.benefit_type,
          title: payload.title,
          description: payload.description,
          isGuaranteedToAll: payload.is_guaranteed_to_all,
          awardValue: payload.award_value,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to add benefit.");
    }
  });

  app.get("/api/hackathons/:id/milestones", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(eventMilestones).where(eq(eventMilestones.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list milestones.");
    }
  });

  app.post("/api/hackathons/:id/milestones", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = milestoneCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventMilestones)
        .values({
          eventId: id,
          milestoneType: payload.milestone_type,
          milestoneName: payload.milestone_name,
          dueAt: payload.due_at,
          timezoneName: payload.timezone_name,
          isConfirmed: payload.is_confirmed,
          notes: payload.notes,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to add milestone.");
    }
  });

  app.get("/api/hackathons/:id/categories", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db
        .select({
          eventId: eventCategoryAssignments.eventId,
          categoryId: eventCategoryAssignments.categoryId,
          isPrimary: eventCategoryAssignments.isPrimary,
          categoryName: eventCategories.categoryName,
        })
        .from(eventCategoryAssignments)
        .innerJoin(eventCategories, eq(eventCategories.categoryId, eventCategoryAssignments.categoryId))
        .where(eq(eventCategoryAssignments.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list category assignments.");
    }
  });

  app.post("/api/hackathons/:id/categories", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = categoryAssignmentSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventCategoryAssignments)
        .values({
          eventId: id,
          categoryId: payload.category_id,
          isPrimary: payload.is_primary,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to assign category.");
    }
  });

  app.get("/api/hackathons/:id/shortlist", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(shortlistEntries).where(eq(shortlistEntries.eventId, id)).limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: "Shortlist entry not found." });
      return { data: toApiRecord(row) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load shortlist entry.");
    }
  });

  app.put("/api/hackathons/:id/shortlist", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = shortlistWriteSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const values = {
        eventId: id,
        queueType: payload.queue_type,
        whyPractical: payload.why_practical,
        shortlistedByMemberId: payload.shortlisted_by_member_id,
        confirmedEligibility: payload.confirmed_eligibility,
        expectedCostSummary: payload.expected_cost_summary,
        scheduleFeasibility: payload.schedule_feasibility,
        technicalRelevance: payload.technical_relevance,
        organizerCredibility: payload.organizer_credibility,
        learningNetworkingPotential: payload.learning_networking_potential,
        evidenceQualityNotes: payload.evidence_quality_notes,
        stillNeedsVerification: payload.still_needs_verification,
      };
      const [row] = await db
        .insert(shortlistEntries)
        .values(values)
        .onConflictDoUpdate({
          target: shortlistEntries.eventId,
          set: {
            queueType: values.queueType,
            whyPractical: values.whyPractical,
            shortlistedByMemberId: values.shortlistedByMemberId,
            confirmedEligibility: values.confirmedEligibility,
            expectedCostSummary: values.expectedCostSummary,
            scheduleFeasibility: values.scheduleFeasibility,
            technicalRelevance: values.technicalRelevance,
            organizerCredibility: values.organizerCredibility,
            learningNetworkingPotential: values.learningNetworkingPotential,
            evidenceQualityNotes: values.evidenceQualityNotes,
            stillNeedsVerification: values.stillNeedsVerification,
          },
        })
        .returning();
      return { data: toApiRecord(row!) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to save shortlist entry.");
    }
  });

  app.get("/api/hackathons/:id/requirements", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db
        .select()
        .from(applicationRequirements)
        .where(eq(applicationRequirements.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list application requirements.");
    }
  });

  app.post("/api/hackathons/:id/requirements", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = requirementCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(applicationRequirements)
        .values({
          eventId: id,
          queueType: payload.queue_type,
          requirementType: payload.requirement_type,
          requirementText: payload.requirement_text,
          dueAt: payload.due_at,
          status: payload.status,
          ownerMemberId: payload.owner_member_id,
          notes: payload.notes,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to add application requirement.");
    }
  });

  app.patch("/api/hackathons/:id/requirements/:requirementId", async (request, reply) => {
    const params = idParamSchema
      .extend({ requirementId: idParamSchema.shape.id })
      .parse(request.params);
    const patch = requirementUpdateSchema.parse(request.body);
    try {
      const [row] = await db
        .update(applicationRequirements)
        .set({
          queueType: patch.queue_type,
          requirementType: patch.requirement_type,
          requirementText: patch.requirement_text,
          dueAt: patch.due_at,
          status: patch.status,
          ownerMemberId: patch.owner_member_id,
          notes: patch.notes,
        })
        .where(
          and(
            eq(applicationRequirements.requirementId, params.requirementId),
            eq(applicationRequirements.eventId, params.id),
          ),
        )
        .returning();
      if (!row) return reply.code(404).send({ error: "Application requirement not found." });
      return { data: toApiRecord(row) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to update application requirement.");
    }
  });

  app.get("/api/hackathons/:id/verifications", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      const rows = await db.select().from(eventVerifications).where(eq(eventVerifications.eventId, id));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list verifications.");
    }
  });

  app.post("/api/hackathons/:id/verifications", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const payload = verificationCreateSchema.parse(request.body);
    try {
      if (!(await eventExists(id))) return reply.code(404).send({ error: "Hackathon not found." });
      const [row] = await db
        .insert(eventVerifications)
        .values({
          eventId: id,
          checkedByMemberId: payload.checked_by_member_id,
          verificationScope: payload.verification_scope,
          result: payload.result,
          notes: payload.notes,
        })
        .returning();
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to record verification.");
    }
  });
};
