import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { eventBenefits, eventMilestones, eventSources, eventTracks } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { benefitCreateSchema, idParamSchema, milestoneCreateSchema, sourceCreateSchema, trackCreateSchema } from "../schemas/details.js";
import { eventExists } from "./event-detail-shared.js";

export async function registerEventDetailRecordRoutes(app: FastifyInstance) {
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

}
