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

describe("directory role changes", () => {
  const mapping = {
    admin: "cn=admins,dc=codyza,dc=local",
    researcher: "cn=research,dc=codyza,dc=local",
    viewer: "cn=viewers,dc=codyza,dc=local",
  };

  function directory(result: Awaited<ReturnType<DirectoryAuthenticator["authenticate"]>>): DirectoryAuthenticator {
    return { async authenticate() { return result; } };
  }
  it("rejects a bad directory password, an unmapped group, and a changed role's old token", async () => {
    const accounts = createMemoryAccounts();
    const tokens = createMemoryTokenStore();
    let groups = [mapping.admin];
    app = await buildApp({
      userStore: accounts.userStore,
      tokenStore: tokens,
      dummyPasswordHash: await hashPassword("dummy-password", 4),
      groupMapping: mapping,
      directory: {
        async authenticate(email, password) {
          if (email === "person@example.com" && password === "wrong") {
            return { status: "invalid" };
          }
          if (email === "outsider@example.com") {
            return { status: "authenticated", identity: { email, dn: "uid=outsider,dc=codyza,dc=local", groups: ["cn=other"] } };
          }
          if (email === "person@example.com") {
            return { status: "authenticated", identity: { email, dn: "uid=person,dc=codyza,dc=local", groups } };
          }
          return { status: "not-found" };
        },
      },
      saveDirectoryAccount: async (input) => {
        const existing = accounts.users.find((user) => user.email === input.email);
        if (existing) {
          const previousRole = existing.role;
          existing.role = input.role;
          existing.authSource = "ldap";
          existing.passwordHash = null;
          existing.ldapDn = input.ldapDn;
          return { user: existing, previousRole };
        }
        const user = localUser({
          id: "55555555-5555-5555-5555-555555555555",
          email: input.email,
          role: input.role,
          authSource: "ldap",
          passwordHash: null,
          ldapDn: input.ldapDn,
        });
        accounts.users.push(user);
        return { user, previousRole: null };
      },
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "person@example.com", password: "wrong" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "Invalid email or password." });
    expect(accounts.users).toHaveLength(0);

    const outsider = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "outsider@example.com", password: "secret" },
    });
    expect(outsider.statusCode).toBe(403);
    expect(accounts.users).toHaveLength(0);

    const admin = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "person@example.com", password: "secret" },
    });
    expect(admin.json().user.role).toBe("admin");
    const adminToken = admin.json().token as string;

    groups = [mapping.viewer];
    const viewer = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "person@example.com", password: "secret" },
    });
    expect(viewer.json().user.role).toBe("viewer");
    const old = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${adminToken}` },
    });
    expect(old.statusCode).toBe(401);
    const current = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${viewer.json().token}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ role: "viewer" });
  });

});
