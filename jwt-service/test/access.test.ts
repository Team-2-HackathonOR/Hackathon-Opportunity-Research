import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createMemoryTokenStore } from "../src/db/token-store.js";
import type { AppUser } from "../src/db/users.js";
import type { DirectoryAuthenticator } from "../src/lib/directory.js";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/token.js";
import { createMemoryAccounts } from "./memory-accounts.js";

const secret = "test-jwt-secret-at-least-32-characters";
const issuer = "team-2-gateway";
const gatewayHeaders = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
};
const jsonHeaders = {
  ...gatewayHeaders,
  "content-type": "application/json",
};
const adminHeaders = {
  ...gatewayHeaders,
  "x-user-id": "22222222-2222-2222-2222-222222222222",
  "x-user-role": "admin",
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function localUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "researcher@local",
    passwordHash: "hash",
    role: "researcher",
    authSource: "local",
    ldapDn: null,
    ...overrides,
  };
}

async function start(users: AppUser[], options: Parameters<typeof buildApp>[0] = { userStore: { async findByEmail() { return null; }, async findById() { return null; } } }) {
  const accounts = createMemoryAccounts(users);
  app = await buildApp({
    ...options,
    userStore: accounts.userStore,
    invitationStore: accounts.invitationStore,
    tokenStore: options.tokenStore,
    dummyPasswordHash: await hashPassword("dummy-password", 4),
    bcryptRounds: 4,
  });
  return { service: app, accounts };
}

describe("persisted token checks", () => {
  it("rejects a missing row, a revoked row, a rewritten role, and a lowered account role", async () => {
    const passwordHash = await hashPassword("correct-password", 4);
    const tokens = createMemoryTokenStore();
    const { service, accounts } = await start([localUser({ passwordHash })], { tokenStore: tokens, userStore: createMemoryAccounts().userStore });

    const login = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "researcher@local", password: "correct-password" },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().token as string;

    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ role: "admin", sub: localUser().id, iss: issuer })).toString("base64url");
    const noneToken = `${header}.${body}.`;
    const none = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${noneToken}` },
    });
    expect(none.statusCode).toBe(401);

    const wrongIssuer = await signAccessToken(localUser(), {
      secret,
      issuer: "other-issuer",
      ttlSeconds: 60,
    });
    await tokens.save(wrongIssuer.record);
    const wrong = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${wrongIssuer.token}` },
    });
    expect(wrong.statusCode).toBe(401);

    const [encodedHeader, encodedPayload, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload ?? "", "base64url").toString()) as { role: string };
    payload.role = "admin";
    const edited = `${encodedHeader}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    const tampered = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${edited}` },
    });
    expect(tampered.statusCode).toBe(401);

    const orphan = await signAccessToken(localUser(), { secret, issuer, ttlSeconds: 60 });
    const missingRow = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${orphan.token}` },
    });
    expect(missingRow.statusCode).toBe(401);

    const logout = await service.inject({
      method: "POST",
      url: "/logout",
      headers: { ...gatewayHeaders, authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ revoked: true });
    const again = await service.inject({
      method: "POST",
      url: "/logout",
      headers: { ...gatewayHeaders, authorization: `Bearer ${token}` },
    });
    expect(again.statusCode).toBe(401);

    const second = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const secondToken = second.json().token as string;
    const record = await tokens.findById(JSON.parse(Buffer.from(secondToken.split(".")[1] ?? "", "base64url").toString()).jti);
    expect(record).not.toBeNull();
    if (record) {
      await tokens.save({ ...record, role: "admin" });
    }
    const mismatched = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${secondToken}` },
    });
    expect(mismatched.statusCode).toBe(401);

    const third = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const thirdToken = third.json().token as string;
    const account = accounts.users[0];
    if (account) {
      account.role = "viewer";
    }
    const lowered = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${thirdToken}` },
    });
    expect(lowered.statusCode).toBe(401);
  });

});
