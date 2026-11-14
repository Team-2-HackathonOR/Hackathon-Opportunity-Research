const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("../../hackscout-gateway/node_modules/@electric-sql/pglite");
const root = path.resolve(__dirname, "..", "..");
const id = "11111111-1111-4111-8111-111111111111";
const lease = "22222222-2222-4222-8222-222222222222";
const clear = "33333333-3333-4333-8333-333333333333";
const raw = { id: 402, fetchedAt: "2026-11-13T00:00:00.000Z", title: "Original source", nested: { value: "Preserve me" } };
const failure = {
  source: "storage", processed_count: 1, inserted_count: 0, failed_count: 1, next_after_id: 402, successes: [],
  failures: [{ record_index: 0, source_identifier: "402", reason: "Record does not satisfy the event schema.", raw_record: raw }],
};
async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["20261112180000_edge_pipeline.sql", "20261113035500_pipeline_ack.sql",
    "20261113130000_pipeline_resume.sql", "20261113140000_pipeline_clear.sql",
    "20261113220000_pipeline_dead_letters.sql", "20261113220100_dead_letter_resume.sql",
    "20261113220200_dead_letter_clear.sql"]) {
    const sql = await readFile(path.join(root, "supabase", "migrations", name), "utf8");
    await db.exec(sql.replace(/^CREATE EXTENSION[^;\n]*;\s*$/gm, ""));
  }
  await db.exec(`CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text,active boolean);
    INSERT INTO cron.job VALUES ('hackscout-edge-tick',true);
    CREATE SCHEMA hackathon_research; CREATE TABLE hackathon_research.events(id int);
    INSERT INTO hackathon_research.events VALUES (1);`);
  const job = {
    id, status: "running", stage: "etl", startedAt: raw.fetchedAt, stagingBackend: "supabase-storage", reset: {},
    scraper: { uniqueHackathonsPersisted: 2, pagesPersisted: 1 },
    etl: { processed: 0, inserted: 0, failed: 0 },
    steps: { reset: { status: "completed" }, scraper: { status: "completed" }, etl: { status: "running" } },
    cursor: { phase: "etl", page: 1, afterId: 401 },
  };
  await db.query(`INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor,key_ciphertext,execution_id,execution_until)
    VALUES ($1,'running',$2,now()+interval '1 hour','supabase','encrypted-fixture',$3,now()+interval '10 minutes')`, [id, job, lease]);
  await db.query(`INSERT INTO pipeline_control.operations(job_id,name,status,result)
    VALUES ($1,'etl-401','completed',$2)`, [id, failure]);
  return { db, job };
}
const archive = (db, record = raw, token = lease) =>
  db.query("SELECT pipeline_control.archive_edge_dead_letter($1,$2,$3,$4) AS id", [id, token, "etl-401", record]);
const pause = (db) => db.query(`UPDATE pipeline_control.jobs SET status='failed',execution_id=NULL,execution_until=NULL,
  job=job || '{"status":"failed","error":"Paused."}'::jsonb WHERE id=$1`, [id]);
module.exports = { fixture, archive, pause, id, lease, clear, raw, failure };
