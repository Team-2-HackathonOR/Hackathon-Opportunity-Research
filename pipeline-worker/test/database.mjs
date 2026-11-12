import { readFile } from "node:fs/promises";
import { PipelineStore } from "../src/store.mjs";
import { PGlite } from "@electric-sql/pglite";

export async function testDatabase(t) {
  const database = new PGlite();
  await database.exec(await readFile(new URL("../migrations/001_pipeline_control.sql", import.meta.url), "utf8"));
  t.after(() => database.close());
  const query = (sql, params) => database.query(sql, params);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { database, pool, store: new PipelineStore(pool) };
}

export function testEnvironment(t) {
  for (const [key, value] of Object.entries({
    PIPELINE_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    GATEWAY_INTERNAL_SECRET: "fixture-gateway-secret",
    CRON_SECRET: "fixture-cron-secret",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}
