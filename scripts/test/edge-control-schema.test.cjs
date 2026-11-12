const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");

test("Edge control DDL upgrades existing jobs, denies browser roles and dispatches cron only through gateway", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await db.exec(await readFile(path.join(root, "pipeline-worker/migrations/001_pipeline_control.sql"), "utf8"));
    await db.exec(`
      CREATE SCHEMA vault;
      CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
      CREATE SCHEMA net;
      CREATE TABLE net.requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms integer);
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
      RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO net.requests(url,headers,body,timeout_ms)
        VALUES (url,headers,body,timeout_milliseconds) RETURNING id
      $$;
      INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at)
      VALUES ('11111111-1111-4111-8111-111111111111','completed','{}',now());
    `);
    // Platform extensions are unavailable in WASM; exercise the actual DDL/function against equivalent interfaces.
    const migration = (await readFile(path.join(root, "supabase/migrations/20261112180000_edge_pipeline.sql"), "utf8"))
      .replace(/^CREATE EXTENSION[^;\n]*;\s*$/gm, "");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query("SELECT executor FROM pipeline_control.jobs")).rows[0].executor, "vercel");
    assert.equal((await db.query("SELECT value->>'frequency' AS frequency FROM pipeline_control.schedule")).rows[0].frequency, "off");
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(`SELECT has_schema_privilege($1,'pipeline_control','USAGE') AS schema_access,
        has_table_privilege($1,'pipeline_control.jobs','SELECT') AS read_jobs,
        has_function_privilege($1,'pipeline_control.dispatch_edge_tick()','EXECUTE') AS tick`, [role]);
      assert.deepEqual(rows[0], { schema_access: false, read_jobs: false, tick: false });
    }
    await assert.rejects(db.query("SELECT pipeline_control.dispatch_edge_tick()"), /Configure the HTTPS gateway/);
    await db.exec(`
      INSERT INTO vault.decrypted_secrets VALUES
        ('hackscout_gateway_url','https://gateway.example.test'),
        ('hackscout_gateway_secret','fixture-gateway-secret');
    `);
    await db.query("SELECT pipeline_control.dispatch_edge_tick()");
    const request = (await db.query("SELECT url,headers,body,timeout_ms FROM net.requests")).rows[0];
    assert.deepEqual(request, {
      url: "https://gateway.example.test/api/internal/pipeline-worker/pipeline/tick",
      headers: { "Content-Type": "application/json", "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "fixture-gateway-secret" },
      body: {}, timeout_ms: 120000,
    });
    await db.exec(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ('22222222-2222-4222-8222-222222222222','queued','{}',now()+interval '1 hour','supabase')`);
    await assert.rejects(db.exec(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
      VALUES ('33333333-3333-4333-8333-333333333333','running','{}',now()+interval '1 hour','supabase')`), /one_active_pipeline/);
  } finally { await db.close(); }
});
