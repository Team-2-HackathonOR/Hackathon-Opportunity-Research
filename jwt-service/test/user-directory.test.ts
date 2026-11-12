import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ query: vi.fn<(query: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>() }));
vi.mock("pg", () => ({
  default: { Pool: class {
    query = bridge.query;
    async connect() { return { query: bridge.query, release() {} }; }
    async end() {}
  } },
}));
import { createPgUserDirectory } from "../src/db/users.js";
interface TestDatabase {
  exec(query: string): Promise<unknown>;
  query(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows: number }>;
  close(): Promise<void>;
}
const require = createRequire(new URL("../../hackscout-gateway/package.json", import.meta.url));
const { PGlite }: { PGlite: new () => TestDatabase } = require("@electric-sql/pglite");
const database = new PGlite();
const directory = createPgUserDirectory({ DATABASE_URL: "postgresql://unused.test/test", DATABASE_SSL: false });
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  bridge.query.mockImplementation(async (query, params) => {
    const result = await database.query(query, params);
    return { rows: result.rows, rowCount: result.affectedRows };
  });
  await database.exec(await readFile(new URL("../../supabase/auth/001_auth.sql", import.meta.url), "utf8"));
  await database.exec(`
    INSERT INTO app_auth.app_users(id,email,role) VALUES
      ('${id}','mine@example.test','admin'), ('${other}','other@example.test','viewer');
    INSERT INTO app_auth.invitations(email,role,token_hash,expires_at,invited_by) VALUES
      ('invited@example.test','viewer','first',now()+interval '1 day','${id}'),
      ('mine@example.test','admin','second',now()+interval '1 day','${other}');
    INSERT INTO app_auth.jwt_tokens(token_id,token_sha,user_id,role,issuer,issued_at,expires_at) VALUES
      (gen_random_uuid(),'fixture','${id}','admin','test',1,9999999999),
      (gen_random_uuid(),'other','${other}','viewer','test',1,9999999999);
  `);
});
afterAll(async () => { await database.close(); });
it("initial password SQL only updates a preapproved local admin once", async () => {
  expect(await directory.setInitialAdminPassword("other@example.test", "viewer-hash")).toBeNull();
  expect((await directory.setInitialAdminPassword("mine@example.test", "admin-hash"))?.role).toBe("admin");
  expect(await directory.setInitialAdminPassword("mine@example.test", "replacement")).toBeNull();
  expect((await directory.findByEmail("mine@example.test"))?.passwordHash).toBe("admin-hash");
});
it("rolls back token and invitation deletion when account deletion fails", async () => {
  await database.exec(`
    CREATE FUNCTION app_auth.reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected failure'; END; $$;
    CREATE TRIGGER reject_delete BEFORE DELETE ON app_auth.app_users
      FOR EACH ROW EXECUTE FUNCTION app_auth.reject_delete();
  `);
  await expect(directory.deleteAccount(id)).rejects.toThrow("Injected failure");
  expect((await database.query("SELECT count(*)::int AS count FROM app_auth.jwt_tokens")).rows[0]?.count).toBe(2);
  expect((await database.query("SELECT count(*)::int AS count FROM app_auth.invitations")).rows[0]?.count).toBe(2);
  await database.exec("DROP TRIGGER reject_delete ON app_auth.app_users;");
});
it("atomically deletes the account, all sessions and related invitations without touching other accounts", async () => {
  expect(await directory.deleteAccount(id)).toBe(true);
  expect(await directory.findById(id)).toBeNull();
  expect((await directory.findById(other))?.email).toBe("other@example.test");
  expect((await database.query("SELECT count(*)::int AS count FROM app_auth.jwt_tokens")).rows[0]?.count).toBe(1);
  expect((await database.query("SELECT count(*)::int AS count FROM app_auth.invitations")).rows[0]?.count).toBe(0);
  expect(await directory.deleteAccount(id)).toBe(false);
});
