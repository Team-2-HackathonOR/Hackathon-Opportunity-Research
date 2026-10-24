import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  options: "-c search_path=hackathon_research,public",
});

export const db = drizzle(pool, { schema });

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch (error) {
    if (env.NODE_ENV === "development") {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[db] readiness check failed:", message);
    }
    return false;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
}
