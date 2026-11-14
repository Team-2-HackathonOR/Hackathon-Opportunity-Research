import { db,HttpError,PipelineFailure } from "../runtime.ts";
import type { EventInput } from "./schema.ts";
import { teamMemberSchema } from "./schema.ts";
import { guardPipelineImport, receiptConflict, storePipelineReceipt, successfulReceipt, type ReceiptWrite } from "./receipts.ts";
type StoredEvent = Pick<EventInput, "event_name" | "operational_status" | "evidence_confidence"> & { event_id: number | string };

export async function createTeamMember(input: unknown) {
  const member = teamMemberSchema.parse(input);
  const rows = await db()`INSERT INTO hackathon_research.team_members ${db()(member)} RETURNING *`;
  return rows[0];
}

export async function createEvent(payload: EventInput, requestDeadline = Date.now() + 20000, receiptWrite?: ReceiptWrite) {
  const deadline = Math.min(requestDeadline, Date.now() + 20000);
  return await db().begin(async (sql) => {
    const beforeQuery = async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new HttpError(504, "ETL write budget exhausted. Split the input into smaller batches.");
      await sql`SELECT set_config('statement_timeout',${String(remaining)},true)`;
    };
    if (receiptWrite) {
      await beforeQuery();
      const saved = await guardPipelineImport(sql, receiptWrite.context);
      if (saved) {
        const event = saved.successes[0];
        if (saved.next_after_id !== receiptWrite.sourceId || !event ||
            event.source_identifier !== receiptWrite.sourceIdentifier) receiptConflict();
        await beforeQuery();
        await storePipelineReceipt(sql, receiptWrite.context, receiptWrite.source, saved);
        return { event_id: event.event_id, event_name: event.event_name, receipt: saved };
      }
    }
    const ids = [...new Set([
      payload.primary_researcher_id, payload.verifier_id, payload.shortlist_entry?.shortlisted_by_member_id,
      ...payload.application_requirement_items.map((v) => v.owner_member_id),
      ...payload.organizer_follow_ups.map((v) => v.assigned_member_id),
      ...payload.verifications.map((v) => v.checked_by_member_id), ...payload.contributions.map((v) => v.member_id),
    ].filter((v): v is number => v !== null && v !== undefined))];
    if (ids.length) {
      await beforeQuery();
      const members = await sql`SELECT member_id FROM hackathon_research.team_members WHERE member_id IN ${sql(ids)}`;
      const found = new Set(members.map((v) => v.member_id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) throw new HttpError(400, `Unknown team member ids: ${missing.join(", ")}`);
    }
    const { categories, tracks, benefits, sources, milestones, shortlist_entry,
      application_requirement_items, organizer_follow_ups, verifications, contributions, ...event } = payload;
    event.last_verified_at ??= new Date().toISOString();
    await beforeQuery();
    const [inserted] = await sql<StoredEvent[]>`INSERT INTO hackathon_research.events ${sql(event)}
      RETURNING event_id,event_name,operational_status,evidence_confidence`;
    const event_id = Number(inserted.event_id);
    if (!Number.isSafeInteger(event_id) || event_id <= 0) {
      throw new PipelineFailure(503, "ETL_EVENT_ID_INVALID", "pause",
        "Database event identifier cannot be represented safely; the event transaction was rolled back.");
    }
    for (const category of categories) {
      await beforeQuery();
      const [row] = await sql`INSERT INTO hackathon_research.event_categories (category_name)
        VALUES (${category.category_name.trim()})
        ON CONFLICT (category_name) DO UPDATE SET category_name=EXCLUDED.category_name RETURNING category_id`;
      await beforeQuery();
      await sql`INSERT INTO hackathon_research.event_category_assignments ${sql({
        event_id, category_id: row.category_id, is_primary: category.is_primary,
      })}`;
    }
    const tables = {
      event_tracks: tracks, event_benefits: benefits,
      event_sources: sources.map((v) => ({ ...v, verified_on: v.verified_on ?? new Date().toISOString() })),
      event_milestones: milestones.map((v) => ({ ...v, last_verified_at: v.last_verified_at ?? new Date().toISOString() })),
      shortlist_entries: shortlist_entry ? [{ ...shortlist_entry, shortlisted_at: shortlist_entry.shortlisted_at ?? new Date().toISOString() }] : [],
      application_requirements: application_requirement_items, organizer_follow_ups,
      event_verifications: verifications.map((v) => ({ ...v, checked_at: v.checked_at ?? new Date().toISOString() })),
      contribution_log: contributions.map((v) => ({ ...v, contributed_at: v.contributed_at ?? new Date().toISOString() })),
    };
    for (const [table, records] of Object.entries(tables)) {
      for (const record of records) {
        await beforeQuery();
        await sql`INSERT INTO ${sql(`hackathon_research.${table}`)} ${sql({ event_id, ...record })}`;
      }
    }
    await beforeQuery();
    if (receiptWrite) {
      const receipt = successfulReceipt({ event_id, event_name: inserted.event_name }, receiptWrite);
      await storePipelineReceipt(sql, receiptWrite.context, receiptWrite.source, receipt);
      return { ...inserted, event_id, receipt };
    }
    return { ...inserted, event_id };
  });
}
