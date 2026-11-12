const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");

async function fragments(directory, pattern) {
  const files = (await readdir(path.join(root, directory))).filter((v) => pattern.test(v)).sort();
  return await Promise.all(files.map((file) => readFile(path.join(root, directory, file), "utf8")));
}
async function metadata(db) {
  return (await db.query(`
    SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='hackathon_research'
    ORDER BY table_name,ordinal_position
  `)).rows;
}

test("split migration matches standalone schema and safely skips already-applied legacy DDL", async () => {
  const standalone = new PGlite();
  const migrated = new PGlite();
  try {
    for (const sql of await fragments("ETL/schema", /\.sql$/)) await standalone.exec(sql);
    const parts = await fragments("supabase/migrations", /^2026102018000[0-3]_/);
    assert.equal(parts.length, 4);
    for (const sql of parts) await migrated.exec(sql);
    assert.deepEqual(await metadata(migrated), await metadata(standalone));
    await standalone.exec(`INSERT INTO hackathon_research.events(event_name,operational_status,evidence_confidence)
      VALUES ('Preserved listing','monitor','low');`);
    const before = await metadata(standalone);
    for (const sql of parts) await standalone.exec(sql);
    assert.deepEqual(await metadata(standalone), before);
    assert.equal((await standalone.query("SELECT event_name FROM hackathon_research.events")).rows[0].event_name, "Preserved listing");
    for (const sql of parts) await migrated.exec(sql);
    assert.deepEqual(await metadata(migrated), before);
  } finally {
    await standalone.close();
    await migrated.close();
  }
});
