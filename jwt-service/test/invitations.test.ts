import type { FastifyInstance } from "fastify";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { createMemoryAccounts } from "./memory-accounts.js";

const secret = "test-jwt-secret-at-least-32-characters";
const issuer = "team-2-gateway";
const gatewayHeaders = {
  "content-type": "application/json",
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
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

function tokenFrom(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get("token") ?? "";
}

async function createService(accounts = createMemoryAccounts()) {
  app = await buildApp({
    userStore: accounts.userStore,
    invitationStore: accounts.invitationStore,
    bcryptRounds: 4,
    dummyPasswordHash: await hashPassword("dummy-password", 4),
  });
  return { service: app, accounts };
}

async function invite(service: FastifyInstance, email = "new.researcher@example.com") {
  const response = await service.inject({
    method: "POST",
    url: "/invitations",
    headers: adminHeaders,
    payload: { email, role: "researcher" },
  });
  return response;
}

describe("invitation sign-in", () => {
  it("creates an account from an invite and signs a token that login and verify accept", async () => {
    const { service } = await createService();
    const created = await invite(service, " New.Researcher@Example.com ");

    expect(created.statusCode).toBe(201);
    const body = created.json() as { inviteUrl: string; email: string; role: string; invitationId: string };
    expect(body.email).toBe("new.researcher@example.com");
    expect(body.role).toBe("researcher");
    expect(body.invitationId).toEqual(expect.any(String));
    expect(created.json().mail).toBe("skipped");
    const inviteToken = tokenFrom(body.inviteUrl);
    expect(inviteToken.length).toBeGreaterThan(32);

    const accepted = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: inviteToken, password: "correct-password" },
    });

    expect(accepted.statusCode).toBe(200);
    const session = accepted.json() as { token: string; user: { email: string; role: string } };
    expect(session.user).toMatchObject({ email: "new.researcher@example.com", role: "researcher" });
    expect(session).not.toHaveProperty("passwordHash");
    const verified = await jwtVerify(session.token, new TextEncoder().encode(secret), { issuer });
    expect(verified.payload.role).toBe("researcher");

    const login = await service.inject({
      method: "POST",
      url: "/login",
      headers: gatewayHeaders,
      payload: { email: "new.researcher@example.com", password: "correct-password" },
    });
    const check = await service.inject({
      method: "POST",
      url: "/verify",
      headers: {
        "x-gateway-caller": "team-2-gateway",
        "x-gateway-secret": "test-gateway-secret-value",
        authorization: `Bearer ${session.token}`,
      },
    });

    expect(login.statusCode).toBe(200);
    expect(check.statusCode).toBe(200);
    expect(check.json()).toMatchObject({ email: "new.researcher@example.com", role: "researcher" });

    const again = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: inviteToken, password: "correct-password" },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: "Invitation is invalid or expired." });
  });

  it("rejects a replaced, expired, or edited invite and an email that already has an account", async () => {
    const accounts = createMemoryAccounts([
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "taken@example.com",
        passwordHash: "hash",
        role: "viewer",
        authSource: "local",
        ldapDn: null,
      },
    ]);
    const { service } = await createService(accounts);

    const taken = await invite(service, "taken@example.com");
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: "An account with this email already exists." });

    const first = await invite(service);
    const second = await invite(service);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstToken = tokenFrom(first.json().inviteUrl as string);
    const secondToken = tokenFrom(second.json().inviteUrl as string);

    const replaced = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: firstToken, password: "correct-password" },
    });
    expect(replaced.statusCode).toBe(400);

    accounts.invitations[1]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: secondToken, password: "correct-password" },
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.json()).toEqual({ error: "Invitation is invalid or expired." });

    const fresh = await invite(service, "another@example.com");
    const freshToken = tokenFrom(fresh.json().inviteUrl as string);
    const edited = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: `${freshToken.slice(0, -1)}x`, password: "correct-password" },
    });
    expect(edited.statusCode).toBe(400);

    accounts.users.push({
      id: "33333333-3333-3333-3333-333333333333",
      email: "another@example.com",
      passwordHash: "hash",
      role: "researcher",
      authSource: "local",
      ldapDn: null,
    });
    const raced = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: freshToken, password: "correct-password" },
    });
    expect(raced.statusCode).toBe(409);
    expect(accounts.invitations.find((item) => item.email === "another@example.com")?.usedAt).toBeNull();
  });

  it("requires an admin identity and the gateway caller", async () => {
    const { service } = await createService();

    const researcher = await service.inject({
      method: "POST",
      url: "/invitations",
      headers: { ...gatewayHeaders, "x-user-id": adminHeaders["x-user-id"], "x-user-role": "researcher" },
      payload: { email: "new.researcher@example.com", role: "viewer" },
    });
    const outsider = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: { "content-type": "application/json" },
      payload: { token: "a".repeat(32), password: "correct-password" },
    });
    const shortPassword = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: "a".repeat(32), password: "short" },
    });

    expect(researcher.statusCode).toBe(403);
    expect(researcher.json()).toEqual({ error: "Admin role is required." });
    expect(outsider.statusCode).toBe(403);
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toMatchObject({ error: "Validation failed." });
  });
});
