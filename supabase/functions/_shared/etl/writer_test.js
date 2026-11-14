import assert from "node:assert/strict";
import { PGlite } from "../../../../hackscout-gateway/node_modules/@electric-sql/pglite/dist/index.js";
import { db } from "../runtime.ts";
import { buildBaseEvent } from "./normalization-base.ts";
import { createEvent } from "./writer.ts";

Deno.test("event writer inserts schema-qualified child records and rolls back an invalid child atomically", async () => {
  const previous = Deno.env.get("EDGE_DATABASE_URL");
  Deno.env.set("EDGE_DATABASE_URL", "postgres://fixture:fixture@127.0.0.1:1/fixture");
  const client = db();
  const originalBegin = client.begin;
  const database = new PGlite();
  // Compile with the pinned production client's real builders, without opening a network connection.
  const { stringify } = await import(new URL("./types.js", import.meta.resolve("npm:postgres@3.4.7")).href);
  const transaction = (strings, ...values) => {
    if (!Array.isArray(strings?.raw)) return client(strings, ...values);
    const query = client(strings, ...values);
    const parameters = [];
    const text = stringify(query, query.strings[0], query.args[0], parameters, [], client.options);
    return database.query(text, parameters).then(result => result.rows);
  };
  client.begin = async callback => {
    await database.exec("BEGIN");
    try {
      const result = await callback(transaction);
      await database.exec("COMMIT");
      return result;
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    const payload = buildBaseEvent({
      title: "Writer regression", url: "https://example.test/hackathon", themes: ["AI"],
    }, null, null);
    const children = new Set(["categories", "tracks", "benefits", "sources", "milestones", "shortlist_entry",
      "application_requirement_items", "organizer_follow_ups", "verifications", "contributions"]);
    const columns = Object.keys(payload).filter(name => !children.has(name)).map(name => `"${name}" text`).join(",");
    await database.exec(`CREATE SCHEMA hackathon_research;
      CREATE TABLE hackathon_research.events(event_id serial PRIMARY KEY,${columns});
      CREATE TABLE hackathon_research.event_categories(category_id serial PRIMARY KEY,category_name text UNIQUE);
      CREATE TABLE hackathon_research.event_category_assignments(
        event_id int REFERENCES hackathon_research.events,category_id int,is_primary boolean);
      CREATE TABLE hackathon_research.event_tracks(
        event_id int REFERENCES hackathon_research.events,track_type text,track_name text,description text);
      CREATE TABLE hackathon_research.event_sources(
        event_id int REFERENCES hackathon_research.events,source_type text,
        source_url text CHECK(source_url LIKE 'https://%'),source_title text,
        is_primary_source boolean,captured_on date,verified_on timestamptz,notes text);`);
    const event = await createEvent(payload);
    assert.equal(event.event_name, "Writer regression");
    const sources = await database.query("SELECT event_id,source_url FROM hackathon_research.event_sources");
    assert.deepEqual(sources.rows, [{ event_id: event.event_id, source_url: "https://example.test/hackathon" }]);
    const tracks = await database.query("SELECT event_id,track_name FROM hackathon_research.event_tracks");
    assert.deepEqual(tracks.rows, [{ event_id: event.event_id, track_name: "AI" }]);
    await assert.rejects(createEvent({
      ...payload, event_name: "Must roll back",
      sources: [{ ...payload.sources[0], source_url: "invalid" }],
    }), /check constraint/);
    const remaining = await database.query("SELECT event_name FROM hackathon_research.events");
    assert.deepEqual(remaining.rows, [{ event_name: "Writer regression" }]);
  } finally {
    client.begin = originalBegin;
    await client.end();
    await database.close();
    if (previous === undefined) Deno.env.delete("EDGE_DATABASE_URL");
    else Deno.env.set("EDGE_DATABASE_URL", previous);
  }
});
