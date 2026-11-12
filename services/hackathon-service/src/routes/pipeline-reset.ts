import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { replyForDatabaseError } from "../lib/http.js";

export const pipelineResetRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/internal/pipeline/reset", async (request, reply) => {
    try {
      const deleted = await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          LOCK TABLE public.event_suggestions, hackathon_research.events IN EXCLUSIVE MODE
        `);
        await transaction.execute(sql`
          UPDATE public.event_suggestions SET published_event_id = NULL
          WHERE published_event_id IS NOT NULL
        `);
        await transaction.execute(sql`
          DELETE FROM hackathon_research.contribution_log WHERE event_id IS NOT NULL
        `);
        const result = await transaction.execute(sql`DELETE FROM hackathon_research.events`);
        if (result.rowCount === null) throw new Error("Missing reset deletion count.");
        return result.rowCount;
      });
      request.log.warn({ deletedEvents: deleted, requestId: request.id }, "Pipeline cleared event listings.");
      return { reset: true, deletedEvents: deleted };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to reset event listings.");
    }
  });
};
