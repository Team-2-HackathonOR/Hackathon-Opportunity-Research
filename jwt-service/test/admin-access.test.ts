import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AdminSetupStore, AppUser } from "../src/db/users.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { createMemoryAccounts } from "./memory-accounts.js";

const headers = { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "test-gateway-secret-value" };
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const user = (overrides: Partial<AppUser> = {}): AppUser => ({
  id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test",
  passwordHash: null, role: "admin", authSource: "local", ldapDn: null, ...overrides,
});
async function setup(initial: AppUser[]) {
  const accounts = createMemoryAccounts(initial);
  const setInitialAdminPassword = vi.fn<AdminSetupStore["setInitialAdminPassword"]>(async (email, passwordHash) => {
    const account = accounts.users.find((item) => item.email === email && item.role === "admin" &&
      item.authSource === "local" && item.passwordHash === null);
    if (!account) return null;
    account.passwordHash = passwordHash;
    return account;
  });
  app = await buildApp({
    userStore: accounts.userStore, adminSetupStore: { setInitialAdminPassword },
    bcryptRounds: 4, dummyPasswordHash: await hashPassword("dummy-password", 4),
  });
  return { service: app, accounts, setInitialAdminPassword };
}
describe("Weather-style administrator access", () => {
  it("normalizes email and distinguishes first password setup, existing password and LDAP", async () => {
    const { service, accounts } = await setup([user()]);
    const access = () => service.inject({ method: "POST", url: "/admin/access", headers, payload: { email: " ADMIN@Example.test " } });
    expect((await access()).json()).toEqual({ email: "admin@example.test", passwordSetupRequired: true });
    accounts.users[0]!.passwordHash = "existing-hash";
    expect((await access()).json().passwordSetupRequired).toBe(false);
    accounts.users[0]!.passwordHash = null;
    accounts.users[0]!.authSource = "ldap";
    expect((await access()).json().passwordSetupRequired).toBe(false);
  });
  it("does not create accounts or elevate nonadmins and requires the gateway", async () => {
    const { service, accounts, setInitialAdminPassword } = await setup([user({ role: "viewer" })]);
    for (const route of ["/admin/access", "/admin/create-password"]) {
      for (const email of ["admin@example.test", "unknown@example.test"]) {
        expect((await service.inject({
          method: "POST", url: route, headers,
          payload: { email, ...(route.endsWith("create-password") ? { password: "correct-password" } : {}) },
        })).statusCode).toBe(403);
      }
    }
    expect((await service.inject({ method: "POST", url: "/admin/access", payload: { email: "admin@example.test" } })).statusCode).toBe(403);
    expect(accounts.users).toHaveLength(1);
    expect(accounts.users[0]!.role).toBe("viewer");
    expect(setInitialAdminPassword).not.toHaveBeenCalled();
  });
  it("hashes the initial password, issues a verified session and prevents overwrites", async () => {
    const { service, accounts } = await setup([user()]);
    const create = () => service.inject({
      method: "POST", url: "/admin/create-password", headers,
      payload: { email: "admin@example.test", password: "correct-password" },
    });
    const results = await Promise.all([create(), create()]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const session = results.find((result) => result.statusCode === 200)!.json();
    expect(session.user.role).toBe("admin");
    expect(await verifyPassword("correct-password", accounts.users[0]!.passwordHash!)).toBe(true);
    expect((await service.inject({
      method: "POST", url: "/verify", headers: { ...headers, authorization: `Bearer ${session.token}` },
    })).statusCode).toBe(200);
    expect((await create()).statusCode).toBe(409);
  });
  it("rejects weak passwords, extra role fields and directory password setup", async () => {
    const { service, accounts } = await setup([user()]);
    for (const payload of [
      { email: "admin@example.test", password: "short" },
      { email: "admin@example.test", password: "x".repeat(73) },
      { email: "admin@example.test", password: "correct-password", role: "admin" },
    ]) expect((await service.inject({ method: "POST", url: "/admin/create-password", headers, payload })).statusCode).toBe(400);
    accounts.users[0]!.authSource = "ldap";
    expect((await service.inject({
      method: "POST", url: "/admin/create-password", headers,
      payload: { email: "admin@example.test", password: "correct-password" },
    })).statusCode).toBe(409);
  });
});
