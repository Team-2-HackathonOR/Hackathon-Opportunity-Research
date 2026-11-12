import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { events } from "../db/schema.js";

export async function eventExists(eventId: number): Promise<boolean> {
  const rows = await db.select({ eventId: events.eventId }).from(events).where(eq(events.eventId, eventId)).limit(1);
  return Boolean(rows[0]);
}
