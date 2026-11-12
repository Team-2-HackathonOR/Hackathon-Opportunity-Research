import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../migrations/001_pipeline_control.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
  console.log("Pipeline control schema is ready. No application data was deleted.");
} catch (error) {
  console.error("Pipeline migration failed.", { code: error.code || "connection_or_migration_error" });
  process.exitCode = 1;
} finally {
  // Closing an uncommitted connection rolls back a failed migration.
  await client.end();
}
