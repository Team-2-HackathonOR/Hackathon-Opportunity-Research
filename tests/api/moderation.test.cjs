const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { assert, connect, call, login } = require("./helpers.cjs");
test("vertical: anonymous suggestion stays private until authenticated, atomic admin publication", async () => {
  const db = connect();
  const name = `CI moderation ${randomUUID()}`;
  let eventId;
  try {
    await call("/api/hackscout/admin/suggestions", 401);
    await call("/api/hackscout/suggestions", 201, { method: "POST",
      body: { event: name, website: "https://events.example.test/moderated" },
      headers: { "x-user-role": "admin", "x-user-id": randomUUID() } });
    const [submission] = (await db.query("SELECT * FROM public.event_suggestions WHERE event_name=$1", [name])).rows;
    assert.equal(submission.status, "pending");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events WHERE event_name=$1", [name])).rows[0].n, 0);
    const session = await login();
    const queue = await call(`/api/hackscout/admin/suggestions?search=${encodeURIComponent(name)}`, 200, { token: session.token });
    assert.equal(queue.total, 1);
    const event = { event_name: name, organizer_name: "CI organizer", official_website: submission.website,
      format: "virtual", event_start_date: `${new Date().getUTCFullYear() + 1}-06-01`,
      description: "Synthetic integration event", technical_tracks: "AI" };
    const route = `/api/hackscout/admin/suggestions/${submission.id}/review`;
    const review = await call(route, 200, { method: "POST", token: session.token,
      headers: { "x-user-id": randomUUID() }, body: { decision: "approved", notes: "CI review", event } });
    eventId = review.published_event_id;
    assert.ok(eventId);
    const stored = (await db.query(`SELECT s.status,s.reviewed_by,e.event_name,e.evidence_confidence,e.operational_status
      FROM public.event_suggestions s JOIN hackathon_research.events e ON e.event_id=s.published_event_id
      WHERE s.id=$1`, [submission.id])).rows[0];
    assert.equal(stored.reviewed_by, session.user.id);
    assert.equal(stored.event_name, name);
    assert.equal(stored.evidence_confidence, "low");
    assert.equal(stored.operational_status, "needs_confirmation");
    const listings = await call("/api/hackscout/hackathons?include=details&after_event_id=0", 200);
    assert.ok(listings.data.some((item) => item.event_name === name));
    await call(route, 409, { method: "POST", token: session.token,
      body: { decision: "approved", notes: "Duplicate must fail", event } });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM hackathon_research.events WHERE event_name=$1", [name])).rows[0].n, 1);
    await call("/api/auth/logout", 200, { method: "POST", token: session.token, body: {} });
    await call("/api/hackscout/admin/suggestions", 401, { token: session.token });
  } finally {
    await db.query("DELETE FROM public.event_suggestions WHERE event_name=$1", [name]);
    if (eventId) await db.query("DELETE FROM hackathon_research.events WHERE event_id=$1", [eventId]);
    await db.end();
  }
});
