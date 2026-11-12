import { pgSchema, timestamp } from "drizzle-orm/pg-core";

export const research = pgSchema("hackathon_research");
export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
