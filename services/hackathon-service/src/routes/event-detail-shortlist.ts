import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { eventCategories, eventCategoryAssignments, events, shortlistEntries } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { categoryAssignmentSchema, idParamSchema, shortlistWriteSchema } from "../schemas/details.js";
import { eventExists } from "./event-detail-shared.js";

export async function registerEventDetailShortlistRoutes(app: FastifyInstance) {
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

}
