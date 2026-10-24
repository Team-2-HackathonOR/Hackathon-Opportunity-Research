import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/token.js";

const secret = "test-jwt-secret-at-least-32-characters";
const issuer = "team-2-gateway";
const gatewayHeaders = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("token verification", () => {
  it("accepts a token from login and rejects an expired or edited token", async () => {
    const passwordHash = await hashPassword("correct-password", 4);
    const users = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "researcher@local",
        passwordHash,
        role: "researcher" as const,
        authSource: "local" as const,
        ldapDn: null,
      },
    ];
    app = await buildApp({
      userStore: {
        async findByEmail(email) {
          return users.find((user) => user.email === email) ?? null;
        },
        async findById(id) {
          return users.find((user) => user.id === id) ?? null;
        },
      },
      dummyPasswordHash: await hashPassword("dummy-password", 4),
    });

    const login = await app.inject({
      method: "POST",
      url: "/login",
      headers: { ...gatewayHeaders, "content-type": "application/json" },
      payload: { email: "researcher@local", password: "correct-password" },
    });
    const token = login.json().token as string;

    const verified = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${token}` },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      email: "researcher@local",
      role: "researcher",
    });

    const expired = await signAccessToken(
      { id: "11111111-1111-1111-1111-111111111111", email: "researcher@local", role: "researcher" },
      { secret, issuer, ttlSeconds: 30, now: Math.floor(Date.now() / 1000) - 120 },
    );
    const rejected = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${expired.token}` },
    });
    const tampered = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { ...gatewayHeaders, authorization: `Bearer ${token.slice(0, -2)}aa` },
    });

    expect(rejected.statusCode).toBe(401);
    expect(tampered.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ error: "Invalid or expired token." });
  });

  it("rejects verify calls that do not come from the gateway", async () => {
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
    });

    const response = await app.inject({
      method: "POST",
      url: "/verify",
      headers: { authorization: "Bearer token" },
    });

    expect(response.statusCode).toBe(403);
  });
});
