import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import { toApiRecord, toEventInsert, toEventUpdate } from "../db/mappers.js";
import { applicationRequirements, eventBenefits, eventSources, eventTracks, events } from "../db/schema.js";
import { replyForDatabaseError, rejectRule } from "../lib/http.js";
import { assertEventConstraints, type IdentityInput } from "../lib/verification.js";
import { eventCreateSchema, eventListQuerySchema, eventUpdateSchema, type EventCreateInput } from "../schemas/hackathon.js";
import { registerHackathonViewRoutes } from "./hackathon-views.js";

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

export const hackathonRoutes: FastifyPluginAsync = async (app) => {
  app.register(registerHackathonViewRoutes);
  app.get("/api/hackathons", async (request, reply) => {
    const query = eventListQuerySchema.parse(request.query);
    const conditions = [];
    if (query.operational_status) conditions.push(eq(events.operationalStatus, query.operational_status));
    if (query.evidence_confidence) conditions.push(eq(events.evidenceConfidence, query.evidence_confidence));
    if (query.format) conditions.push(eq(events.format, query.format));
    if (query.after_event_id !== undefined) conditions.push(gt(events.eventId, query.after_event_id));

    try {
      const fetched = await db
        .select()
        .from(events)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(...(query.after_event_id !== undefined
          ? [asc(events.eventId)]
          : [sql`${events.registrationDeadlineAt} asc nulls last`, asc(events.eventName), asc(events.eventId)]))
        .limit(query.limit + (query.after_event_id !== undefined ? 1 : 0));
      const rows = fetched.slice(0, query.limit);
      const data = rows.map(toApiRecord);
      if (query.include === "details" && rows.length > 0) {
        const eventIds = rows.map(({ eventId }) => eventId);
        const [tracks, benefits, sources, requirements] = await Promise.all([
          db.select().from(eventTracks).where(inArray(eventTracks.eventId, eventIds)),
          db.select().from(eventBenefits).where(inArray(eventBenefits.eventId, eventIds)),
          db.select().from(eventSources).where(inArray(eventSources.eventId, eventIds)),
          db.select().from(applicationRequirements).where(inArray(applicationRequirements.eventId, eventIds)),
        ]);
        const groupByEventId = <T extends { eventId: number }>(items: T[]) => {
          const grouped = new Map<number, T[]>();
          for (const item of items) {
            const group = grouped.get(item.eventId) ?? [];
            group.push(item);
            grouped.set(item.eventId, group);
          }
          return grouped;
        };
        const tracksByEvent = groupByEventId(tracks);
        const benefitsByEvent = groupByEventId(benefits);
        const sourcesByEvent = groupByEventId(sources);
        const requirementsByEvent = groupByEventId(requirements);
        for (let index = 0; index < rows.length; index += 1) {
          const eventId = rows[index]!.eventId;
          Object.assign(data[index]!, {
            tracks: (tracksByEvent.get(eventId) ?? []).map(toApiRecord),
            benefits: (benefitsByEvent.get(eventId) ?? []).map(toApiRecord),
            sources: (sourcesByEvent.get(eventId) ?? []).map(toApiRecord),
            requirements: (requirementsByEvent.get(eventId) ?? []).map(toApiRecord),
          });
        }
      }
      return {
        data, count: data.length,
        ...(query.after_event_id !== undefined
          ? { next_after_id: fetched.length > query.limit ? rows.at(-1)!.eventId : null }
          : {}),
      };
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
