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

describe("persisted token revocation", () => {
  it("revokes every active session for one user", async () => {
    const passwordHash = await hashPassword("correct-password", 4);
    const otherHash = await hashPassword("other-password", 4);
    const tokens = createMemoryTokenStore();
    const { service } = await start(
      [
        localUser({ passwordHash }),
        localUser({
          id: "33333333-3333-3333-3333-333333333333",
          email: "other@local",
          passwordHash: otherHash,
          role: "viewer",
        }),
      ],
      { tokenStore: tokens, userStore: createMemoryAccounts().userStore },
    );

    const first = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const second = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const other = await service.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "other@local", password: "other-password" },
    });

    const revoked = await service.inject({
      method: "POST",
      url: "/users/11111111-1111-1111-1111-111111111111/revoke-sessions",
      headers: adminHeaders,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: 2 });

    for (const token of [first.json().token, second.json().token]) {
      const check = await service.inject({
        method: "POST",
        url: "/verify",
        headers: { ...gatewayHeaders, authorization: `Bearer ${token}` },
      });
      expect(check.statusCode).toBe(401);
    }
    const kept = await service.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${other.json().token}` },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ email: "other@local", role: "viewer" });
  });
});
