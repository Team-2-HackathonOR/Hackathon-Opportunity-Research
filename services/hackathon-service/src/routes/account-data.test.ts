import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: { NODE_ENV: "test", SERVICE_NAME: "hackathon-service", LOG_LEVEL: "silent", GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value" },
}));
vi.mock("../db/client.js", () => ({ db: { transaction: vi.fn() }, checkDatabaseConnection: vi.fn() }));
import { db } from "../db/client.js";
import { buildApp } from "../app.js";
interface TestDatabase {
  exec(query: string): Promise<unknown>;
  query(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows: number }>;
  transaction<T>(callback: (transaction: TestDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const require = createRequire(new URL("../../../../hackscout-gateway/package.json", import.meta.url));
const { PGlite }: { PGlite: new () => TestDatabase } = require("@electric-sql/pglite");
const database = new PGlite();
const app = await buildApp();
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const headers = {
  "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "test-gateway-secret-value",
  "x-user-id": id, "x-user-role": "viewer", "x-user-email": "mine@example.test",
};
beforeAll(async () => {
  await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const file of ["20261020180000_hackathon_research.sql", "20261106170000_event_suggestion_moderation.sql"]) {
    await database.exec(await readFile(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  vi.mocked(db.transaction).mockImplementation(async (callback) => database.transaction(async (transaction) => {
    const execute = async (query: SQLWrapper) => {
      const compiled = new PgDialect().sqlToQuery(query.getSQL());
      const result = await transaction.query(compiled.sql, compiled.params);
      return { rows: result.rows, rowCount: result.affectedRows };
    };
    return callback({ execute } as Parameters<typeof callback>[0]);
  }));
  await database.exec(`
    INSERT INTO hackathon_research.team_members(full_name,email)
      VALUES ('Mine','mine@example.test'), ('Other','other@example.test');
    INSERT INTO hackathon_research.events(event_name,operational_status,evidence_confidence,primary_researcher_id)
      VALUES ('Shared listing','needs_confirmation','low',1);
    INSERT INTO hackathon_research.contribution_log(member_id,event_id,contribution_type,notes)
      VALUES (1,1,'research','Mine'), (2,1,'research','Other');
    INSERT INTO hackathon_research.event_verifications(event_id,checked_by_member_id,verification_scope,result)
      VALUES (1,1,'Mine','confirmed'), (1,2,'Other','confirmed');
    INSERT INTO public.event_suggestions(event_name,website,reviewed_by,review_notes)
      VALUES ('Mine','https://example.test','${id}','Personal review'),
             ('Other','https://example.test','${otherId}','Other review');
  `);
});
afterAll(async () => { await app.close(); await database.close(); });
it("rejects untrusted or incomplete identities without changing personal records", async () => {
  expect((await app.inject({ method: "DELETE", url: "/api/account-data" })).statusCode).toBe(403);
  expect((await app.inject({
    method: "DELETE", url: "/api/account-data", headers: { ...headers, "x-user-email": "" },
  })).statusCode).toBe(403);
  expect(db.transaction).not.toHaveBeenCalled();
});
it("rolls back anonymization and linked deletions when a dependent deletion fails", async () => {
  await database.exec(`
    CREATE FUNCTION public.reject_member_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected failure'; END; $$;
    CREATE TRIGGER reject_member_delete BEFORE DELETE ON hackathon_research.team_members
      FOR EACH ROW EXECUTE FUNCTION public.reject_member_delete();
  `);
  expect((await app.inject({ method: "DELETE", url: "/api/account-data", headers })).statusCode).toBe(500);
  expect((await database.query("SELECT review_notes FROM public.event_suggestions WHERE event_name='Mine'")).rows[0]?.review_notes).toBe("Personal review");
  expect((await database.query("SELECT count(*)::int AS count FROM hackathon_research.contribution_log")).rows[0]?.count).toBe(2);
  await database.exec("DROP TRIGGER reject_member_delete ON hackathon_research.team_members;");
});
it("removes only the user's linked data, anonymizes reviews and preserves public events and other users", async () => {
  const response = await app.inject({ method: "DELETE", url: "/api/account-data", headers });
  expect(response.json()).toEqual({ deleted: true });
  for (const table of ["team_members", "contribution_log", "event_verifications", "events"]) {
    expect((await database.query(`SELECT count(*)::int AS count FROM hackathon_research.${table}`)).rows[0]?.count).toBe(1);
  }
  expect((await database.query("SELECT primary_researcher_id FROM hackathon_research.events")).rows[0]?.primary_researcher_id).toBeNull();
  expect((await database.query("SELECT reviewed_by, review_notes FROM public.event_suggestions WHERE event_name='Mine'")).rows[0])
    .toEqual({ reviewed_by: null, review_notes: null });
  expect((await database.query("SELECT reviewed_by, review_notes FROM public.event_suggestions WHERE event_name='Other'")).rows[0])
    .toEqual({ reviewed_by: otherId, review_notes: "Other review" });
  expect((await app.inject({ method: "DELETE", url: "/api/account-data", headers })).json()).toEqual({ deleted: true });
});
