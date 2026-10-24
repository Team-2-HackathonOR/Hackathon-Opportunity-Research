import type { FastifyInstance } from "fastify";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppUser, UserStore } from "../src/db/users.js";
import { hashPassword } from "../src/lib/password.js";

const secret = "test-jwt-secret-at-least-32-characters";
const issuer = "team-2-gateway";
const gatewayHeaders = {
  "content-type": "application/json",
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createApp(users: AppUser[]) {
  const store: UserStore = {
    async findByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
  };
  app = await buildApp({
    userStore: store,
    dummyPasswordHash: await hashPassword("dummy-password", 4),
  });
  return app;
}

describe("jwt login", () => {
  it("returns a token for a matching email and password", async () => {
    const passwordHash = await hashPassword("correct-password", 4);
    const service = await createApp([
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "researcher@local",
        passwordHash,
        role: "researcher",
        authSource: "local",
        ldapDn: null,
      },
    ]);

    const response = await service.inject({
      method: "POST",
      url: "/login",
      headers: gatewayHeaders,
      payload: { email: " Researcher@Local ", password: "correct-password" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; user: { id: string; email: string; role: string } };
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      email: "researcher@local",
      role: "researcher",
    });
    const verified = await jwtVerify(body.token, new TextEncoder().encode(secret), { issuer });
    expect(verified.payload.role).toBe("researcher");
    expect(response.json().passwordHash).toBeUndefined();
  });

  it("returns the same error for an unknown email and a wrong password", async () => {
    const passwordHash = await hashPassword("correct-password", 4);
    const service = await createApp([
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "researcher@local",
        passwordHash,
        role: "researcher",
        authSource: "local",
        ldapDn: null,
      },
    ]);

    const unknown = await service.inject({
      method: "POST",
      url: "/login",
      headers: gatewayHeaders,
      payload: { email: "missing@local", password: "correct-password" },
    });
    const wrong = await service.inject({
      method: "POST",
      url: "/login",
      headers: gatewayHeaders,
      payload: { email: "researcher@local", password: "nope" },
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ error: "Invalid email or password." });
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects login that does not come from the gateway", async () => {
    const service = await createApp([]);

    const missing = await service.inject({
      method: "POST",
      url: "/login",
      headers: { "content-type": "application/json" },
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const health = await service.inject({ method: "GET", url: "/health" });

    expect(missing.statusCode).toBe(403);
    expect(health.statusCode).toBe(200);
  });

  it("rejects a login body without an email", async () => {
    const service = await createApp([]);
    const response = await service.inject({
      method: "POST",
      url: "/login",
      headers: gatewayHeaders,
      payload: { password: "correct-password" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Validation failed." });
  });
});
