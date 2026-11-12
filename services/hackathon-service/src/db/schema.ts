export { research } from "./schema/base.js";
export * from "./schema/enums.js";
export * from "./schema/core.js";
export * from "./schema/catalog.js";
export * from "./schema/views.js";

import { events } from "./schema/core.js";
import { organizerFollowUps } from "./schema/catalog.js";

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;
export type FollowUpRow = typeof organizerFollowUps.$inferSelect;
export type FollowUpInsert = typeof organizerFollowUps.$inferInsert;
