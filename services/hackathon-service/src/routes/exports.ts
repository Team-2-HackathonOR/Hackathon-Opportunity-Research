import { asc } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { codyzaShortlist, events, organizerFollowUps } from "../db/schema.js";
import { toCsv } from "../lib/csv.js";

function sendCsv(reply: { header: (name: string, value: string) => void }, filename: string, rows: object[]) {
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  return toCsv(rows.map(toApiRecord));
}

export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/exports/master-database.csv", async (request, reply) => {
    try {
      const rows = await db.select().from(events).orderBy(asc(events.eventName));
      return sendCsv(reply, "master-hackathon-database.csv", rows);
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, "failed to export master database");
      return reply.code(500).send({ error: "Failed to export master database." });
    }
  });

  app.get("/api/exports/shortlist.csv", async (request, reply) => {
    try {
      const rows = await db.select().from(codyzaShortlist);
      return sendCsv(reply, "codyza-shortlist.csv", rows);
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, "failed to export shortlist");
      return reply.code(500).send({ error: "Failed to export shortlist." });
    }
  });

  app.get("/api/exports/organizer-followups.csv", async (request, reply) => {
    try {
      const rows = await db.select().from(organizerFollowUps).orderBy(asc(organizerFollowUps.sentAt));
      return sendCsv(reply, "organizer-followup-log.csv", rows);
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, "failed to export organizer follow-ups");
      return reply.code(500).send({ error: "Failed to export organizer follow-ups." });
    }
  });
};
