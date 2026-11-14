import { PGlite } from "../../../../hackscout-gateway/node_modules/@electric-sql/pglite/dist/index.js";
import { db } from "../runtime.ts";
import { buildBaseEvent } from "./normalization-base.ts";
import { metadata } from "../staging-objects.ts";

export async function receiptFixture() {
  const vars = { EDGE_DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:1/fixture",
    SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-private-key",
    STAGING_STORAGE_BUCKET: "hackscout-staging", STAGING_STORAGE_PREFIX: "hackscout/raw" };
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  const database = new PGlite();
  const client = db(), originalBegin = client.begin;
  const { stringify } = await import(new URL("./types.js", import.meta.resolve("npm:postgres@3.4.7")).href);
  const transaction = (strings, ...values) => {
    if (!Array.isArray(strings?.raw)) return client(strings, ...values);
    const query = client(strings, ...values), parameters = [];
    const text = stringify(query, query.strings[0], query.args[0], parameters, [], client.options);
    return (async () => {
      // Match postgres.js inferred JSON encoding rather than PGlite's permissive string binding.
      await database.exec(`PREPARE receipt_wire_probe AS ${text}`);
      const { rows } = await database.query(`SELECT parameter_types::text[] AS types
        FROM pg_prepared_statements WHERE name='receipt_wire_probe'`);
      await database.exec("DEALLOCATE receipt_wire_probe");
      const encoded = parameters.map((value, index) => value !== null &&
        ["json", "jsonb"].includes(rows[0].types[index]) ? JSON.stringify(value) : value);
      const result = await database.query(text, encoded);
      const bigints = result.fields.filter(field => field.dataTypeID === 20).map(field => field.name);
      for (const row of result.rows) {
        for (const name of bigints) if (row[name] !== null) row[name] = String(row[name]);
      }
      return result.rows;
    })();
  };
  transaction.json = client.json;
  client.begin = async callback => {
    await database.exec("BEGIN");
    try {
      const result = await callback(transaction);
      await database.exec("COMMIT");
      return result;
    } catch (error) { await database.exec("ROLLBACK"); throw error; }
  };
  const context = { pipeline_job_id: "11111111-1111-4111-8111-111111111111", pipeline_operation: "etl-first",
    pipeline_execution_id: "22222222-2222-4222-8222-222222222222", fetched_at: "2026-11-13T20:00:00.000Z", after_id: null };
  const raw = { id: 820, fetchedAt: context.fetched_at, title: "Receipt regression", url: "https://example.test/hackathon" };
  const payload = buildBaseEvent(raw, null, null);
  const children = new Set(["categories", "tracks", "benefits", "sources", "milestones", "shortlist_entry",
    "application_requirement_items", "organizer_follow_ups", "verifications", "contributions"]);
  const columns = Object.keys(payload).filter(name => !children.has(name)).map(name => `"${name}" text`).join(",");
  await database.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA pipeline_control;
    CREATE TABLE pipeline_control.jobs(id uuid PRIMARY KEY,status text,executor text,job jsonb,
      execution_id uuid,execution_until timestamptz,key_expires_at timestamptz,key_ciphertext text);
    CREATE TABLE pipeline_control.operations(job_id uuid REFERENCES pipeline_control.jobs ON DELETE CASCADE,
      name text,status text,PRIMARY KEY(job_id,name));
    CREATE SCHEMA hackathon_research;
    CREATE TABLE hackathon_research.events(event_id bigserial PRIMARY KEY,${columns});
    CREATE TABLE hackathon_research.event_sources(event_id int REFERENCES hackathon_research.events,
      source_type text,source_url text CHECK(source_url LIKE 'https://%'),source_title text,
      is_primary_source boolean,captured_on date,verified_on timestamptz,notes text);`);
  for (const name of ["20261113220400_staging_index.sql", "20261113220500_etl_receipts.sql"]) {
    await database.exec(await Deno.readTextFile(new URL(`../../../../supabase/migrations/${name}`, import.meta.url)));
  }
  await database.query(`INSERT INTO pipeline_control.jobs VALUES($1,'running','supabase',$2,$3,
    now()+interval '10 minutes',now()+interval '1 day','fixture-ciphertext')`,
    [context.pipeline_job_id, { startedAt: context.fetched_at, cursor: { phase: "etl", afterId: null } }, context.pipeline_execution_id]);
  await database.query("INSERT INTO pipeline_control.operations VALUES($1,$2,'started')",
    [context.pipeline_job_id, context.pipeline_operation]);
  const m = await metadata(raw);
  await database.query(`INSERT INTO pipeline_control.staging_index
    (bucket,prefix,fetched_at_ms,source_id,object_name,sha256,byte_size,confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
    [vars.STAGING_STORAGE_BUCKET, vars.STAGING_STORAGE_PREFIX, m.fetched_at_ms, m.source_id, m.object_name, m.sha256, m.byte_size]);
  return { database, client, transaction, context, raw, payload, async close() {
    client.begin = originalBegin;
    await client.end();
    await database.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  } };
}
