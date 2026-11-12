import { asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { contributionLog, eventCategories, teamMembers } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { categoryCreateSchema, contributionCreateSchema, teamMemberCreateSchema } from "../schemas/details.js";

export async function registerEventDetailGeneralRoutes(app: FastifyInstance) {
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
}
