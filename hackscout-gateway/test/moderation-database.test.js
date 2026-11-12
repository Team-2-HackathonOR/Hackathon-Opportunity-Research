const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

test("PostgreSQL moderation migration and atomic publication", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const file of [
    "20261020180000_hackathon_research.sql",
    "20261020180001_hackathon_research_part_2.sql",
    "20261020180002_hackathon_research_part_3.sql",
    "20261020180003_hackathon_research_part_4.sql",
    "20261106090000_hackathon_graphql_access.sql",
    "20261106170000_event_suggestion_moderation.sql",
  ]) {
    await database.exec(await readFile(path.join(__dirname, "..", "..", "supabase", "migrations", file), "utf8"));
  }
  await database.exec("SET search_path = public; SET ROLE service_role;");
  const event = {
    event_name: "Reviewed AI Weekend",
    organizer_name: "Community Builders",
    official_website: "https://example.test/event",
    format: "virtual",
    event_start_date: "2027-01-15",
    event_end_date: "2027-01-16",
    description: "Build a prototype; organizer eligibility still needs confirmation.",
    technical_tracks: "AI",
  };
  const reviewer = "11111111-1111-4111-8111-111111111111";
  async function submit(name) {
    const result = await database.query(
      "INSERT INTO public.event_suggestions(event_name, website) VALUES ($1, $2) RETURNING id",
      [name, "https://example.test/event"]);
    return result.rows[0].id;
  }
  async function moderate(id, decision, details = event, notes = "Organizer website reviewed.") {
    const result = await database.query(
      "SELECT public.moderate_event_suggestion($1, $2, $3, $4, $5::jsonb) AS result",
      [id, decision, reviewer, notes, JSON.stringify(details)]);
    return result.rows[0].result;
  }

  await t.test("pending submission is persisted but not published", async () => {
    const id = await submit("Pending event");
    const result = await database.query("SELECT status, published_event_id FROM public.event_suggestions WHERE id=$1", [id]);
    assert.equal(result.rows[0].status, "pending");
    assert.equal(result.rows[0].published_event_id, null);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0].count, 0);
  });
  await t.test("approval publishes event, topic and review together without claiming verification", async () => {
    const id = await submit("Approved event");
    const result = await moderate(id, "approved");
    assert.equal(result.status, "approved");
    assert.ok(result.published_event_id);
    const records = await database.query(`
      SELECT s.status, s.reviewed_by, s.review_notes, s.reviewed_at,
             e.event_name, e.operational_status, e.evidence_confidence, t.track_name
      FROM public.event_suggestions s
      JOIN hackathon_research.events e ON e.event_id=s.published_event_id
      JOIN hackathon_research.event_tracks t ON t.event_id=e.event_id
      WHERE s.id=$1`, [id]);
    assert.equal(records.rows.length, 1);
    assert.equal(records.rows[0].operational_status, "needs_confirmation");
    assert.equal(records.rows[0].evidence_confidence, "low");
    assert.equal(records.rows[0].reviewed_by, reviewer);
    assert.ok(records.rows[0].reviewed_at);
    assert.equal(records.rows[0].track_name, "AI");
    await assert.rejects(() => moderate(id, "approved"), (error) => error.code === "P0001");
    assert.equal((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0].count, 1);
  });
  await t.test("rejection saves the reason without creating an event", async () => {
    const id = await submit("Rejected event");
    const result = await moderate(id, "rejected", {}, "Duplicate submission.");
    assert.equal(result.published_event_id, null);
    const record = await database.query("SELECT status, review_notes FROM public.event_suggestions WHERE id=$1", [id]);
    assert.deepEqual(record.rows[0], { status: "rejected", review_notes: "Duplicate submission." });
    await assert.rejects(() => moderate(id, "approved"), (error) => error.code === "P0001");
    assert.equal((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0].count, 1);
  });
  await t.test("invalid event details leave the submission pending", async () => {
    const id = await submit("Incomplete event");
    await assert.rejects(() => moderate(id, null), (error) => error.code === "22023");
    await assert.rejects(() => moderate(id, "rejected", {}, ""), (error) => error.code === "22023");
    await assert.rejects(() => moderate(id, "approved", {}), (error) => error.code === "22023");
    await assert.rejects(() => moderate(id, "approved", { ...event, event_end_date: "2027-01-14" }),
      (error) => error.code === "23514");
    const record = await database.query("SELECT status, published_event_id FROM public.event_suggestions WHERE id=$1", [id]);
    assert.deepEqual(record.rows[0], { status: "pending", published_event_id: null });
  });
  await t.test("a failure after event insertion rolls back publication and review", async () => {
    const id = await submit("Failing topic");
    await database.exec(`
      RESET ROLE;
      CREATE FUNCTION public.fail_topic_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Simulated publication failure'; END $$;
      CREATE TRIGGER fail_topic_insert BEFORE INSERT ON hackathon_research.event_tracks
      FOR EACH ROW EXECUTE FUNCTION public.fail_topic_insert();
      SET ROLE service_role;`);
    await assert.rejects(() => moderate(id, "approved", { ...event, event_name: "Failed publication event" }), /Simulated publication failure/);
    const record = await database.query("SELECT status, published_event_id FROM public.event_suggestions WHERE id=$1", [id]);
    assert.deepEqual(record.rows[0], { status: "pending", published_event_id: null });
    assert.equal((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0].count, 1);
    await database.exec("RESET ROLE; DROP TRIGGER fail_topic_insert ON hackathon_research.event_tracks; SET ROLE service_role;");
  });
  await t.test("duplicate event identity cannot be published twice", async () => {
    const id = await submit("Duplicate event");
    await assert.rejects(() => moderate(id, "approved"), (error) => error.code === "23505");
    const record = await database.query("SELECT status, published_event_id FROM public.event_suggestions WHERE id=$1", [id]);
    assert.deepEqual(record.rows[0], { status: "pending", published_event_id: null });
    assert.equal((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0].count, 1);
  });
  await t.test("only service role can execute the moderation function", async () => {
    const grants = await database.query(`
      SELECT has_function_privilege('anon', 'public.moderate_event_suggestion(bigint,text,uuid,text,jsonb)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.moderate_event_suggestion(bigint,text,uuid,text,jsonb)', 'EXECUTE') AS authenticated,
             has_function_privilege('service_role', 'public.moderate_event_suggestion(bigint,text,uuid,text,jsonb)', 'EXECUTE') AS service_role`);
    assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service_role: true });
    await database.exec("RESET ROLE; SET ROLE anon;");
    await assert.rejects(() => moderate(1, "approved"), (error) => error.code === "42501");
    await database.exec("RESET ROLE; SET ROLE service_role;");
  });
  await t.test("migration can be applied again without losing review records", async () => {
    await database.exec("RESET ROLE;");
    await database.exec(await readFile(path.join(__dirname, "..", "..", "supabase", "migrations",
      "20261106170000_event_suggestion_moderation.sql"), "utf8"));
    const result = await database.query("SELECT count(*)::int AS count FROM public.event_suggestions WHERE status='approved'");
    assert.equal(result.rows[0].count, 1);
  });
});
