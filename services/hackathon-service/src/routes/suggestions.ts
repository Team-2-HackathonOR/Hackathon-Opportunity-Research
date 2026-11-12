import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { db } from "../db/client.js";
import { replyForDatabaseError } from "../lib/http.js";
import { isoDateSchema } from "../schemas/enums.js";

const websiteSchema = z.string().trim().max(2048).url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Enter an HTTP or HTTPS website without embedded credentials.");
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");
const optionalWebsite = z.union([websiteSchema, z.literal("")]).optional().default("");
const optionalDate = z.union([isoDateSchema, z.literal("")]).optional().default("");
const eventSchema = z.object({
  event_name: z.string().trim().min(1).max(160),
  organizer_name: z.string().trim().min(1).max(160),
  official_website: websiteSchema,
  registration_link: optionalWebsite,
  format: z.enum(["in_person", "virtual", "hybrid"]),
  event_start_date: isoDateSchema,
  event_end_date: optionalDate,
  city: optionalText(160),
  country: optionalText(160),
  description: z.string().trim().min(1).max(4000),
  technical_tracks: optionalText(1000),
  registration_fee_notes: optionalText(500),
}).superRefine((event, context) => {
  if (event.format !== "virtual" && (!event.city || !event.country)) {
    context.addIssue({ code: "custom", message: "City and country are required for physical events." });
  }
  if (event.event_end_date && event.event_end_date < event.event_start_date) {
    context.addIssue({ code: "custom", message: "The end date cannot precede the start date." });
  }
});
const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved"), notes: optionalText(2000), event: eventSchema }),
  z.object({ decision: z.literal("rejected"), notes: z.string().trim().min(1).max(2000) }),
]);
const queueSchema = z.object({
  status: z.enum(["all", "pending", "approved", "rejected"]).default("pending"),
  page: z.coerce.number().int().min(1).max(999999).default(1),
  search: optionalText(160),
});
const idSchema = z.string().regex(/^[1-9]\d{0,18}$/).refine(
  (id) => BigInt(id) <= 9223372036854775807n,
  "Choose a valid submission.",
);

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

export const suggestionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (path.startsWith("/api/admin/") && request.headers["x-user-role"] !== "admin") {
      return reply.code(403).send({ error: "An administrator role is required." });
    }
  });

  app.post("/api/suggestions", { bodyLimit: 10 * 1024 }, async (request, reply) => {
    const input = z.object({
      event: z.string().trim().min(1).max(160),
      website: websiteSchema,
    }).parse(request.body);
    try {
      await db.execute(sql`
        INSERT INTO public.event_suggestions (event_name, website)
        VALUES (${input.event}, ${input.website})
      `);
      return reply.code(201).send({ status: "submitted" });
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to submit event suggestion.");
    }
  });

  app.get("/api/admin/suggestions", async (request, reply) => {
    const query = queueSchema.parse(request.query);
    const pageSize = 12;
    const search = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const conditions = [
      query.status === "all" ? sql`true` : sql`status = ${query.status}`,
      sql`(event_name ILIKE ${search} OR website ILIKE ${search})`,
    ];
    const where = sql.join(conditions, sql` AND `);
    try {
      const result = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM public.event_suggestions WHERE ${where}) AS total,
          coalesce((
            SELECT jsonb_agg(item ORDER BY item.submitted_at DESC, item.id::bigint DESC)
            FROM (
              SELECT id::text, event_name, website, status, submitted_at,
                reviewed_at, reviewed_by, review_notes, published_event_id::text
              FROM public.event_suggestions WHERE ${where}
              ORDER BY submitted_at DESC, public.event_suggestions.id DESC
              LIMIT ${pageSize} OFFSET ${(query.page - 1) * pageSize}
            ) AS item
          ), '[]'::jsonb) AS items
      `);
      return { ...result.rows[0], page: query.page, pageSize };
    } catch (error) {
      return replyForDatabaseError(request, reply, error, "Failed to load suggestion queue.");
    }
  });

  app.post("/api/admin/suggestions/:id/review", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const reviewer = z.string().uuid().parse(request.headers["x-user-id"]);
    const input = reviewSchema.parse(request.body);
    const event = input.decision === "approved" ? input.event : {};
    try {
      const result = await db.execute(sql`
        SELECT public.moderate_event_suggestion(
          ${id}::bigint, ${input.decision}::text, ${reviewer}::uuid,
          ${input.notes}::text, ${JSON.stringify(event)}::jsonb
        ) AS review
      `);
      const review: unknown = result.rows[0]?.review;
      const validated = z.object({
        id: z.string(),
        status: z.enum(["approved", "rejected"]),
        published_event_id: z.string().nullable(),
      }).safeParse(review);
      if (!validated.success || validated.data.status !== input.decision ||
          (input.decision === "approved" && !validated.data.published_event_id)) {
        request.log.error({ requestId: request.id }, "Invalid moderation publication result.");
        return reply.code(502).send({ error: "The database returned an invalid review result." });
      }
      return validated.data;
    } catch (error) {
      const code = databaseCode(error);
      if (code === "P0001" || code === "P0002") {
        request.log.warn({ err: error, requestId: request.id }, "Suggestion review rejected.");
        return reply.code(code === "P0002" ? 404 : 409).send({
          error: code === "P0002" ? "This submission no longer exists."
            : "This submission has already been reviewed. Refresh the queue.",
        });
      }
      return replyForDatabaseError(request, reply, error, "Failed to review event suggestion.");
    }
  });
};
