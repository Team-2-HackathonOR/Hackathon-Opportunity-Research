import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { replyForDatabaseError } from "../lib/http.js";

export const accountDataRoutes: FastifyPluginAsync = async (app) => {
  app.delete("/api/account-data", async (request, reply) => {
    const identity = z.object({ id: z.string().uuid(), email: z.string().email() }).safeParse({
      id: request.headers["x-user-id"], email: request.headers["x-user-email"],
    });
    if (!identity.success) return reply.code(403).send({ error: "A verified account identity is required." });
    const { id, email } = identity.data;
    try {
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          UPDATE public.event_suggestions SET reviewed_by = NULL, review_notes = NULL
          WHERE reviewed_by = ${id}::uuid
        `);
        await transaction.execute(sql`
          DELETE FROM hackathon_research.contribution_log
          WHERE member_id IN (SELECT member_id FROM hackathon_research.team_members WHERE lower(email) = lower(${email}))
        `);
        await transaction.execute(sql`
          DELETE FROM hackathon_research.event_verifications
          WHERE checked_by_member_id IN (SELECT member_id FROM hackathon_research.team_members WHERE lower(email) = lower(${email}))
        `);
        await transaction.execute(sql`DELETE FROM hackathon_research.team_members WHERE lower(email) = lower(${email})`);
      });
      return { deleted: true };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Could not delete the account's linked research data.");
    }
  });
};
