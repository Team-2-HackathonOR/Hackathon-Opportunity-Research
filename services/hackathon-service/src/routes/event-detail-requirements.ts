import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { applicationRequirements } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { idParamSchema, requirementCreateSchema, requirementUpdateSchema } from "../schemas/details.js";
import { eventExists } from "./event-detail-shared.js";

export async function registerEventDetailRequirementRoutes(app: FastifyInstance) {
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

}
