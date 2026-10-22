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

describe("directory login", () => {
  const mapping = {
    admin: "cn=admins,dc=codyza,dc=local",
    researcher: "cn=research,dc=codyza,dc=local",
    viewer: "cn=viewers,dc=codyza,dc=local",
  };

  function directory(result: Awaited<ReturnType<DirectoryAuthenticator["authenticate"]>>): DirectoryAuthenticator {
    return { async authenticate() { return result; } };
  }

  it("issues a researcher token for a directory group and keeps local login when the directory has no match", async () => {
    const passwordHash = await hashPassword("local-password", 4);
    const accounts = createMemoryAccounts([localUser({ email: "local@example.com", passwordHash })]);
    app = await buildApp({
      userStore: accounts.userStore,
      tokenStore: createMemoryTokenStore(),
      dummyPasswordHash: await hashPassword("dummy-password", 4),
      groupMapping: mapping,
      directory: {
        async authenticate(email) {
          if (email === "directory@example.com") {
            return {
              status: "authenticated",
              identity: { email, dn: "uid=directory,dc=codyza,dc=local", groups: [mapping.researcher] },
            };
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
          id: "44444444-4444-4444-4444-444444444444",
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

    const signedIn = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "directory@example.com", password: "directory-password" },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().user).toMatchObject({ email: "directory@example.com", role: "researcher" });
    const verified = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${signedIn.json().token}` },
    });
    expect(verified.statusCode).toBe(200);

    const local = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "local@example.com", password: "local-password" },
    });
    expect(local.statusCode).toBe(200);
    expect(local.json().user.role).toBe("researcher");
  });

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

  it("returns 503 when the directory cannot be reached", async () => {
    app = await buildApp({
      userStore: {
        async findByEmail() {
          return null;
        },
        async findById() {
          return null;
        },
      },
      dummyPasswordHash: await hashPassword("dummy-password", 4),
      directory: directory({ status: "unavailable" }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/login",
      headers: jsonHeaders,
      payload: { email: "person@example.com", password: "secret" },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe("invite mail", () => {
  it("sends the invite link and still creates the invitation when mail is skipped", async () => {
    const sent: string[] = [];
    const accounts = createMemoryAccounts();
    app = await buildApp({
      userStore: accounts.userStore,
      invitationStore: accounts.invitationStore,
      bcryptRounds: 4,
      dummyPasswordHash: await hashPassword("dummy-password", 4),
      sendMail: async ({ inviteUrl }) => {
        sent.push(inviteUrl);
        return "sent";
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/invitations",
      headers: { ...adminHeaders, "content-type": "application/json" },
      payload: { email: "new.researcher@example.com", role: "researcher" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().mail).toBe("sent");
    expect(sent[0]).toBe(created.json().inviteUrl);
  });
});
