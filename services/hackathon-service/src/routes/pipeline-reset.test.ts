import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test", SERVICE_NAME: "hackathon-service", LOG_LEVEL: "silent",
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
  },
}));
vi.mock("../db/client.js", () => ({
  db: { transaction: vi.fn() },
  checkDatabaseConnection: vi.fn(),
}));
import { db } from "../db/client.js";
import { buildApp } from "../app.js";

interface TestDatabase {
  exec(query: string): Promise<unknown>;
  query(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows: number }>;
  transaction<T>(callback: (transaction: TestDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
// Reuse the repository's existing isolated PostgreSQL test engine.
const require = createRequire(new URL("../../../../hackscout-gateway/package.json", import.meta.url));
const { PGlite }: { PGlite: new () => TestDatabase } = require("@electric-sql/pglite");
const database = new PGlite();
const app = await buildApp();
const headers = { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "test-gateway-secret-value" };

beforeAll(async () => {
  await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const file of ["20261020180000_hackathon_research.sql", "20261106170000_event_suggestion_moderation.sql"]) {
    await database.exec(await readFile(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  vi.mocked(db.transaction).mockImplementation(async (callback) => {
    return database.transaction(async (transaction) => {
      const execute = async (query: SQLWrapper) => {
        const compiled = new PgDialect().sqlToQuery(query.getSQL());
        const result = await transaction.query(compiled.sql, compiled.params);
        return { rows: result.rows, rowCount: result.affectedRows };
      };
      // Only execute is used by this route; route tests still run the real transaction SQL.
      return callback({ execute } as Parameters<typeof callback>[0]);
    });
  });
});
afterAll(async () => { await app.close(); await database.close(); });

describe("pipeline PostgreSQL reset in an isolated database", () => {
  it("denies missing or invalid gateway credentials without deleting data", async () => {
    expect((await app.inject({ method: "POST", url: "/api/internal/pipeline/reset" })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST", url: "/api/internal/pipeline/reset",
      headers: { ...headers, "x-gateway-secret": "wrong" },
    })).statusCode).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("clears events and children, preserving accounts, review history, categories and members", async () => {
    await database.exec(`
      CREATE SCHEMA app_auth;
      CREATE TABLE app_auth.accounts (id integer);
      INSERT INTO app_auth.accounts VALUES (1);
      INSERT INTO hackathon_research.team_members(full_name) VALUES ('Test member');
      INSERT INTO hackathon_research.event_categories(category_name) VALUES ('AI');
      INSERT INTO public.event_suggestions(event_name, website) VALUES ('Reviewed', 'https://example.test');
      SELECT public.moderate_event_suggestion(1, 'approved', '11111111-1111-4111-8111-111111111111',
        'Review retained', '{"event_name":"Approved event","organizer_name":"Test","official_website":"https://example.test","format":"virtual","event_start_date":"2027-01-15","description":"Example","technical_tracks":"AI"}');
      INSERT INTO hackathon_research.event_category_assignments(event_id,category_id) VALUES (1,1);
      INSERT INTO hackathon_research.contribution_log(member_id,event_id,contribution_type,notes)
        VALUES (1,1,'research','Event contribution');
    `);
    const response = await app.inject({ method: "POST", url: "/api/internal/pipeline/reset", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reset: true, deletedEvents: 1 });
    for (const table of ["events", "event_tracks", "event_category_assignments", "contribution_log"]) {
      expect((await database.query(`SELECT count(*)::int AS count FROM hackathon_research.${table}`)).rows[0]?.count).toBe(0);
    }
    for (const table of ["hackathon_research.team_members", "hackathon_research.event_categories", "app_auth.accounts"]) {
      expect((await database.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count).toBe(1);
    }
    expect((await database.query("SELECT status, review_notes, published_event_id FROM public.event_suggestions")).rows[0])
      .toEqual({ status: "approved", review_notes: "Review retained", published_event_id: null });
  });

  it("rolls back review unlinking if event deletion fails", async () => {
    await database.exec(`
      INSERT INTO hackathon_research.events(event_name,operational_status,evidence_confidence)
        VALUES ('Retained on failure','needs_confirmation','low');
      UPDATE public.event_suggestions SET published_event_id = 2 WHERE id = 1;
      CREATE FUNCTION public.reject_reset() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Injected reset failure'; END; $$;
      CREATE TRIGGER reject_reset BEFORE DELETE ON hackathon_research.events
        FOR EACH ROW EXECUTE FUNCTION public.reject_reset();
    `);
    expect((await app.inject({ method: "POST", url: "/api/internal/pipeline/reset", headers })).statusCode).toBe(500);
    expect((await database.query("SELECT published_event_id::int AS id FROM public.event_suggestions")).rows[0]?.id).toBe(2);
    expect((await database.query("SELECT count(*)::int AS count FROM hackathon_research.events")).rows[0]?.count).toBe(1);
  });
});
