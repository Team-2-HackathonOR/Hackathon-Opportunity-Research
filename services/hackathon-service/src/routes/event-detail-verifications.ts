import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { eventVerifications } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { idParamSchema, verificationCreateSchema } from "../schemas/details.js";
import { eventExists } from "./event-detail-shared.js";

export async function registerEventDetailVerificationRoutes(app: FastifyInstance) {
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
}
