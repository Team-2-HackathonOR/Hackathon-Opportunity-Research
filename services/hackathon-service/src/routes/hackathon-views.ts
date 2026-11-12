import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord } from "../db/mappers.js";
import { applyNowQueue, codyzaShortlist, deadlinesNext30Days, deadlinesNext7Days, prepareBeforeOpeningQueue, sourceEvidenceAppendix, travelSupportedOpportunities, upcomingMonitoringList, virtualHybridOpportunities } from "../db/schema.js";
import { replyForDatabaseError } from "../lib/http.js";
import { deadlineQuerySchema } from "../schemas/hackathon.js";

async function selectView(view: typeof applyNowQueue | typeof prepareBeforeOpeningQueue | typeof upcomingMonitoringList | typeof codyzaShortlist | typeof virtualHybridOpportunities | typeof travelSupportedOpportunities | typeof deadlinesNext7Days | typeof deadlinesNext30Days | typeof sourceEvidenceAppendix) {
  const rows = await db.select().from(view);
  return rows.map(toApiRecord);
}

export async function registerHackathonViewRoutes(app: FastifyInstance) {
  app.get("/api/hackathons/views/apply-now", async (request, reply) => {
    try {
      const data = await selectView(applyNowQueue);
      return { data, count: data.length, view: "v_apply_now_queue" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load Apply Now view.");
    }
  });

  app.get("/api/hackathons/views/prepare-before-opening", async (request, reply) => {
    try {
      const data = await selectView(prepareBeforeOpeningQueue);
      return { data, count: data.length, view: "v_prepare_before_opening_queue" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load Prepare Before Opening view.");
    }
  });

  app.get("/api/hackathons/views/monitor", async (request, reply) => {
    try {
      const data = await selectView(upcomingMonitoringList);
      return { data, count: data.length, view: "v_upcoming_monitoring_list" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load monitor view.");
    }
  });

  app.get("/api/hackathons/views/shortlist", async (request, reply) => {
    try {
      const data = await selectView(codyzaShortlist);
      return { data, count: data.length, view: "v_codyza_shortlist" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load shortlist view.");
    }
  });

  app.get("/api/hackathons/views/virtual-hybrid", async (request, reply) => {
    try {
      const data = await selectView(virtualHybridOpportunities);
      return { data, count: data.length, view: "v_virtual_hybrid_opportunities" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load virtual/hybrid view.");
    }
  });

  app.get("/api/hackathons/views/travel-supported", async (request, reply) => {
    try {
      const data = await selectView(travelSupportedOpportunities);
      return { data, count: data.length, view: "v_travel_supported_opportunities" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load travel-supported view.");
    }
  });

  app.get("/api/hackathons/views/evidence", async (request, reply) => {
    try {
      const data = await selectView(sourceEvidenceAppendix);
      return { data, count: data.length, view: "v_source_evidence_appendix" };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load evidence appendix.");
    }
  });

  app.get("/api/hackathons/views/deadlines", async (request, reply) => {
    const { withinDays } = deadlineQuerySchema.parse(request.query);
    try {
      if (withinDays === 7) {
        const data = await selectView(deadlinesNext7Days);
        return { data, count: data.length, withinDays, view: "v_deadlines_next_7_days" };
      }
      if (withinDays === 30) {
        const data = await selectView(deadlinesNext30Days);
        return { data, count: data.length, withinDays, view: "v_deadlines_next_30_days" };
      }

      const result = await db.execute(sql`
        SELECT
          e.event_id,
          e.event_name,
          m.milestone_type,
          m.milestone_name,
          m.due_at,
          m.timezone_name,
          e.registration_link,
          e.official_website
        FROM hackathon_research.event_milestones AS m
        JOIN hackathon_research.events AS e ON e.event_id = m.event_id
        WHERE m.due_at IS NOT NULL
          AND m.due_at >= NOW()
          AND m.due_at < NOW() + (${withinDays}::int * INTERVAL '1 day')
        ORDER BY m.due_at
      `);
      const data = result.rows;
      return { data, count: data.length, withinDays };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load deadline view.");
    }
  });

}
