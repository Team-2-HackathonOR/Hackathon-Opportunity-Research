const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const { root } = require("./local-config.cjs");
async function initialize(pool, status) {
  const database = await pool.connect();
  try {
    const { rows } = await database.query("SELECT to_regclass('pipeline_control.jobs') AS existing");
    if (rows[0].existing) throw new Error("Fixture is not empty. Stop tests/runtime Supabase with --no-backup and start it again.");
    const directory = path.join(root, "supabase", "migrations");
    const migrations = (await readdir(directory)).filter((name) =>
      /^2026102018000[0-3]_/.test(name) || /^\d{14}_/.test(name) && name >= "20261106090000_").sort();
    await database.query("BEGIN");
    try {
      for (const name of migrations) await database.query(await readFile(path.join(directory, name), "utf8"));
      await database.query(await readFile(path.join(root, "supabase", "auth", "001_auth.sql"), "utf8"));
      // The real worker is driven over HTTP by tests; never dispatch external cron requests.
      await database.query("SELECT cron.schedule('hackscout-edge-tick','1 second','SELECT 1')");
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK");
      throw error;
    }
  } finally { database.release(); }
  const response = await fetch(`${status.API_URL}/storage/v1/bucket`, {
    method: "POST", headers: { authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      apikey: status.SERVICE_ROLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ id: "hackscout-staging", name: "hackscout-staging", public: false }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Private fixture bucket creation failed (HTTP ${response.status}).`);
  await response.body?.cancel();
}
module.exports = { initialize };
