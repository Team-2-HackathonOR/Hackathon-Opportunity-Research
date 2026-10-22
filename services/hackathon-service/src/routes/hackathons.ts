import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord, toEventInsert, toEventUpdate } from "../db/mappers.js";
import {
  applyNowQueue,
  codyzaShortlist,
  deadlinesNext30Days,
  deadlinesNext7Days,
  events,
  prepareBeforeOpeningQueue,
  sourceEvidenceAppendix,
  travelSupportedOpportunities,
  upcomingMonitoringList,
  virtualHybridOpportunities,
} from "../db/schema.js";
import { replyForDatabaseError, rejectRule } from "../lib/http.js";
import { assertEventConstraints, type IdentityInput } from "../lib/verification.js";
import {
  deadlineQuerySchema,
  eventCreateSchema,
  eventListQuerySchema,
  eventUpdateSchema,
  type EventCreateInput,
} from "../schemas/hackathon.js";

async function findIdentityConflict(input: IdentityInput, excludeEventId?: number) {
  const conditions = [
    eq(events.eventName, input.event_name),
    sql`coalesce(${events.eventStartDate}, date '1900-01-01') = ${input.event_start_date ?? "1900-01-01"}::date`,
    sql`coalesce(${events.city}, '') = ${input.city ?? ""}`,
    sql`coalesce(${events.country}, '') = ${input.country ?? ""}`,
  ];
  if (excludeEventId !== undefined) {
    conditions.push(ne(events.eventId, excludeEventId));
  }

  const rows = await db
    .select({ eventId: events.eventId, eventName: events.eventName })
    .from(events)
    .where(and(...conditions))
    .limit(1);
  return rows[0];
}

async function selectView(
  view:
    | typeof applyNowQueue
    | typeof prepareBeforeOpeningQueue
    | typeof upcomingMonitoringList
    | typeof codyzaShortlist
    | typeof virtualHybridOpportunities
    | typeof travelSupportedOpportunities
    | typeof deadlinesNext7Days
    | typeof deadlinesNext30Days
    | typeof sourceEvidenceAppendix,
) {
  const rows = await db.select().from(view);
  return rows.map(toApiRecord);
}

export const hackathonRoutes: FastifyPluginAsync = async (app) => {
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

  app.get("/api/hackathons", async (request, reply) => {
    const query = eventListQuerySchema.parse(request.query);
    const conditions = [];
    if (query.operational_status) conditions.push(eq(events.operationalStatus, query.operational_status));
    if (query.evidence_confidence) conditions.push(eq(events.evidenceConfidence, query.evidence_confidence));
    if (query.format) conditions.push(eq(events.format, query.format));

    try {
      const rows = await db
        .select()
        .from(events)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${events.registrationDeadlineAt} asc nulls last`, asc(events.eventName))
        .limit(query.limit);
      const data = rows.map(toApiRecord);
      return { data, count: data.length };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to list hackathons.");
    }
  });

  app.get("/api/hackathons/:id", async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.code(400).send({ error: "event_id must be a positive integer." });
    }

    try {
      const rows = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1);
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: "Hackathon not found." });
      return { data: toApiRecord(row) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to fetch hackathon.");
    }
  });

  app.post("/api/hackathons", async (request, reply) => {
    const payload = eventCreateSchema.parse(request.body);
    try {
      assertEventConstraints(payload);
    } catch (err) {
      return rejectRule(request, reply, err);
    }

    try {
      const existing = await findIdentityConflict(payload);
      if (existing) {
        return reply.code(409).send({
          error: "An event with this name, start date, city, and country already exists.",
          existing_event_id: existing.eventId,
          existing_event_name: existing.eventName,
        });
      }

      const [row] = await db.insert(events).values(toEventInsert(payload)).returning();
      request.log.info(
        { action: "event_created", eventId: row!.eventId, eventName: row!.eventName, requestId: request.id },
        "event created",
      );
      return reply.code(201).send({ data: toApiRecord(row!) });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to create hackathon.");
    }
  });

  app.patch("/api/hackathons/:id", async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.code(400).send({ error: "event_id must be a positive integer." });
    }
    const patch = eventUpdateSchema.parse(request.body);

    try {
      const rows = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1);
      const current = rows[0];
      if (!current) return reply.code(404).send({ error: "Hackathon not found." });

      const merged: EventCreateInput = {
        event_name: patch.event_name ?? current.eventName,
        event_start_date: patch.event_start_date !== undefined ? patch.event_start_date : current.eventStartDate,
        event_end_date: patch.event_end_date !== undefined ? patch.event_end_date : current.eventEndDate,
        city: patch.city !== undefined ? patch.city : current.city,
        country: patch.country !== undefined ? patch.country : current.country,
        team_size_min: patch.team_size_min !== undefined ? patch.team_size_min : current.teamSizeMin,
        team_size_max: patch.team_size_max !== undefined ? patch.team_size_max : current.teamSizeMax,
        registration_fee_amount:
          patch.registration_fee_amount !== undefined
            ? patch.registration_fee_amount
            : current.registrationFeeAmount === null
              ? null
              : Number(current.registrationFeeAmount),
        registration_fee_currency:
          patch.registration_fee_currency !== undefined
            ? patch.registration_fee_currency
            : current.registrationFeeCurrency,
        duplicate_of_event_id:
          patch.duplicate_of_event_id !== undefined ? patch.duplicate_of_event_id : current.duplicateOfEventId,
        operational_status: patch.operational_status ?? current.operationalStatus,
        evidence_confidence: patch.evidence_confidence ?? current.evidenceConfidence,
      };

      try {
        assertEventConstraints({ ...merged, event_id: eventId });
      } catch (err) {
        return rejectRule(request, reply, err);
      }

      const existing = await findIdentityConflict(merged, eventId);
      if (existing) {
        return reply.code(409).send({
          error: "An event with this name, start date, city, and country already exists.",
          existing_event_id: existing.eventId,
        });
      }

      const [row] = await db.update(events).set(toEventUpdate(patch)).where(eq(events.eventId, eventId)).returning();
      request.log.info(
        { action: "event_updated", eventId: row!.eventId, eventName: row!.eventName, requestId: request.id },
        "event updated",
      );
      return { data: toApiRecord(row!) };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to update hackathon.");
    }
  });
};
