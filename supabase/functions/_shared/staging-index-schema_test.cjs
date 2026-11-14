const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("../../../hackscout-gateway/node_modules/@electric-sql/pglite");

test("private staging metadata migration enforces reservations, exact confirmation and unique-run cap", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE SCHEMA pipeline_control; CREATE ROLE anon; CREATE ROLE authenticated; GRANT USAGE ON SCHEMA pipeline_control TO anon,authenticated;");
    await db.exec(readFileSync(join(__dirname, "..", "..", "migrations", "20261113220400_staging_index.sql"), "utf8"));
    const ms = 1794477600000;
    const hash = "a".repeat(64);
    const args = ["hackscout-staging", "hackscout/raw", ms, 2, `${ms}_0000000000000002.json`, hash, 42];
    const prepare = () => db.query("SELECT pipeline_control.prepare_staging_object($1,$2,$3,$4,$5,$6,$7) AS prepared", args);
    assert.equal((await prepare()).rows[0].prepared, true);
    await assert.rejects(db.query("SELECT pipeline_control.require_staging_index_ready($1,$2,$3)", args.slice(0, 3)), /unconfirmed/);
    const confirm = (values) => db.query("SELECT pipeline_control.confirm_staging_object($1,$2,$3,$4,$5,$6,$7) AS confirmed", values);
    assert.equal((await confirm([...args.slice(0, 5), "b".repeat(64), 42])).rows[0].confirmed, false);
    assert.equal((await confirm(args)).rows[0].confirmed, true);
    assert.equal((await db.query("SELECT pipeline_control.require_staging_index_ready($1,$2,$3) AS ready", args.slice(0, 3))).rows[0].ready, true);
    await prepare();
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pipeline_control.staging_index")).rows[0].count, 1);
    await confirm(args);
    await db.exec(`INSERT INTO pipeline_control.staging_index
      SELECT 'hackscout-staging','hackscout/raw',${ms},id,
      '${ms}_'||lpad(id::text,16,'0')||'.json','${hash}',42,true
      FROM generate_series(0,9997) AS id WHERE id<>2`);
    await assert.rejects(db.query("SELECT pipeline_control.prepare_staging_object($1,$2,$3,$4,$5,$6,$7)",
      [...args.slice(0, 3), 9998, `${ms}_0000000000009998.json`, hash, 42]), /9998/);
    assert.equal((await prepare()).rows[0].prepared, true, "An existing ID update was blocked at the cap.");
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT * FROM pipeline_control.staging_index"), /permission denied/);
    await assert.rejects(prepare(), /permission denied/);
    await db.exec("RESET ROLE; SET ROLE authenticated");
    await assert.rejects(db.query("DELETE FROM pipeline_control.staging_index"), /permission denied/);
    await assert.rejects(confirm(args), /permission denied/);
    await db.exec("RESET ROLE");
  } finally { await db.close(); }
});
