import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { createMemoryAccounts } from "./memory-accounts.js";
import { createMemoryTokenStore } from "../src/db/token-store.js";
import { env } from "../src/config/env.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const headers = { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "test-gateway-secret-value" };

async function setup() {
  const hash = await hashPassword("correct-password", 4);
  const accounts = createMemoryAccounts([
    { id: "11111111-1111-4111-8111-111111111111", email: "viewer@example.test", passwordHash: hash, role: "viewer", authSource: "local", ldapDn: null },
    { id: "22222222-2222-4222-8222-222222222222", email: "other@example.test", passwordHash: hash, role: "viewer", authSource: "local", ldapDn: null },
  ]);
  const tokens = createMemoryTokenStore();
  const deleteAccount = vi.fn(async (id: string) => {
    const index = accounts.users.findIndex((user) => user.id === id);
    if (index < 0) return false;
    accounts.users.splice(index, 1);
    await tokens.revokeForUser(id);
    return true;
  });
  app = await buildApp({
    userStore: accounts.userStore, tokenStore: tokens, accountDeletionStore: { deleteAccount },
    dummyPasswordHash: hash, bcryptRounds: 4,
  });
  const login = async () => (await app!.inject({
    method: "POST", url: "/login", headers, payload: { email: "viewer@example.test", password: "correct-password" },
  })).json().token as string;
  return { service: app, accounts, deleteAccount, login };
}
describe("authenticated account deletion", () => {
  it("blocks seed-managed accounts so deletion cannot silently be undone on restart", async () => {
    const { service, deleteAccount, login } = await setup();
    const token = await login();
    const previousEmail = env.SEED_VIEWER_EMAIL;
    const previousPassword = env.SEED_VIEWER_PASSWORD;
    env.SEED_VIEWER_EMAIL = "viewer@example.test";
    env.SEED_VIEWER_PASSWORD = "fixture-seed-password";
    try {
      const response = await service.inject({
        method: "POST", url: "/account/verify-password",
        headers: { ...headers, authorization: `Bearer ${token}` },
        payload: { password: "correct-password", confirmation: "DELETE" },
      });
      expect(response.statusCode).toBe(409);
      expect(deleteAccount).not.toHaveBeenCalled();
    } finally {
      env.SEED_VIEWER_EMAIL = previousEmail;
      env.SEED_VIEWER_PASSWORD = previousPassword;
    }
  });
  it("requires password and confirmation, deletes only the token owner and invalidates every session", async () => {
    const { service, accounts, deleteAccount, login } = await setup();
    const token = await login();
    const otherSession = await login();
    const auth = { ...headers, authorization: `Bearer ${token}` };
    const body = { password: "correct-password", confirmation: "DELETE" };
    expect((await service.inject({
      method: "POST", url: "/account/verify-password", headers: auth, payload: body,
    })).json()).toEqual({ verified: true });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect((await service.inject({
      method: "POST", url: "/account/delete", headers: { ...auth, "x-user-id": accounts.users[1]!.id }, payload: body,
    })).json()).toEqual({ deleted: true });
    expect(accounts.users.map((user) => user.email)).toEqual(["other@example.test"]);
    expect((await service.inject({
      method: "POST", url: "/verify", headers: { ...headers, authorization: `Bearer ${otherSession}` },
    })).statusCode).toBe(401);
  });
  it("never deletes for an invalid session, wrong password, missing confirmation or target ID", async () => {
    const { service, deleteAccount, login } = await setup();
    const authorization = `Bearer ${await login()}`;
    for (const [payload, status] of [
      [{ password: "wrong-password", confirmation: "DELETE" }, 403],
      [{ password: "correct-password" }, 400],
      [{ password: "correct-password", confirmation: "DELETE", id: "someone-else" }, 400],
    ] as const) {
      expect((await service.inject({ method: "POST", url: "/account/delete", headers: { ...headers, authorization }, payload })).statusCode).toBe(status);
    }
    expect((await service.inject({
      method: "POST", url: "/account/delete", headers, payload: { password: "correct-password", confirmation: "DELETE" },
    })).statusCode).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
