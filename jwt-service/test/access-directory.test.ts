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
