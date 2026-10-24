import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord, toFollowUpInsert, toFollowUpUpdate } from "../db/mappers.js";
import { organizerFollowUps } from "../db/schema.js";
import { replyForDatabaseError, rejectRule } from "../lib/http.js";
import { assertFollowupRules } from "../lib/verification.js";
import { followupCreateSchema, followupUpdateSchema } from "../schemas/followup.js";
import { idParamSchema } from "../schemas/details.js";

export const organizerFollowupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/organizer-followups", async (request, reply) => {
    try {
      const rows = await db
        .select()
        .from(organizerFollowUps)
        .orderBy(desc(organizerFollowUps.followUpId));
      return { data: rows.map(toApiRecord), count: rows.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list organizer follow-ups.");
    }
  });

  app.post("/api/organizer-followups", async (request, reply) => {
    const payload = followupCreateSchema.parse(request.body);
    try {
      assertFollowupRules(payload);
    } catch (err) {
      return rejectRule(request, reply, err);
    }

    try {
      const [row] = await db.insert(organizerFollowUps).values(toFollowUpInsert(payload)).returning();
      request.log.info(
        {
          action: "followup_created",
          followUpId: row!.followUpId,
          eventId: row!.eventId,
          responseStatus: row!.responseStatus,
          requestId: request.id,
        },
        "organizer follow-up created",
      );
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to create organizer follow-up.");
    }
  });

  app.patch("/api/organizer-followups/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const patch = followupUpdateSchema.parse(request.body);

    try {
      const existing = await db
        .select()
        .from(organizerFollowUps)
        .where(eq(organizerFollowUps.followUpId, id))
        .limit(1);
      const current = existing[0];
      if (!current) return reply.code(404).send({ error: "Organizer follow-up not found." });

      try {
        assertFollowupRules({
          response_status: patch.response_status ?? current.responseStatus,
          confirmed_answer:
            patch.confirmed_answer !== undefined ? patch.confirmed_answer : current.confirmedAnswer,
        });
      } catch (err) {
        return rejectRule(request, reply, err);
      }

      const [row] = await db
        .update(organizerFollowUps)
        .set(toFollowUpUpdate(patch))
        .where(eq(organizerFollowUps.followUpId, id))
        .returning();
      if (!row) return reply.code(404).send({ error: "Organizer follow-up not found." });

      request.log.info(
        {
          action: "followup_updated",
          followUpId: row.followUpId,
          eventId: row.eventId,
          responseStatus: row.responseStatus,
          requestId: request.id,
        },
        "organizer follow-up updated",
      );
      return { data: toApiRecord(row) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to update organizer follow-up.");
    }
  });
};
