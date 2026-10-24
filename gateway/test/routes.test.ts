import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayApp } from "./create-gateway-app.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
});

describe("gateway routes", () => {
  it("lists hackathon upstreams and marks unconfigured services", async () => {
    app = await createGatewayApp();

    const response = await app.inject({ method: "GET", url: "/gateway/routes" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "team-2-gateway",
      role: "api-gateway",
      routes: [
        { path: "POST /api/auth/login", upstream: "http://127.0.0.1:4004", access: "public" },
        { path: "POST /api/auth/invitations", upstream: "http://127.0.0.1:4004", access: "admin" },
        { path: "POST /api/auth/invitations/accept", upstream: "http://127.0.0.1:4004", access: "public" },
        { path: "POST /api/auth/logout", upstream: "http://127.0.0.1:4004", access: "authenticated" },
        { path: "POST /api/auth/users/:id/revoke-sessions", upstream: "http://127.0.0.1:4004", access: "admin" },
        { path: "GET /api/auth/me", upstream: "gateway", access: "authenticated" },
        { path: "/api/hackathons/*", upstream: "http://127.0.0.1:4001", access: "authenticated" },
        { path: "/api/organizer-followups/*", upstream: "http://127.0.0.1:4001", access: "authenticated" },
        { path: "/api/exports/*", upstream: "http://127.0.0.1:4001", access: "authenticated" },
        { path: "/api/ai/*", upstream: "not configured", access: "authenticated" },
        { path: "/api/scraper/*", upstream: "not configured", access: "authenticated" },
        { path: "/proxy/graphql", upstream: "not configured", access: "public" },
      ],
    });
  });

  it("returns 503 for AI and GraphQL when those upstreams are not set", async () => {
    stubTokenVerification();
    app = await createGatewayApp();
    const token = await signTestToken("viewer");

    const ai = await app.inject({
      method: "GET",
      url: "/api/ai/ping",
      headers: { authorization: `Bearer ${token}` },
    });
    const graphql = await app.inject({ method: "POST", url: "/proxy/graphql" });

    expect(ai.statusCode).toBe(503);
    expect(ai.json()).toEqual({
      error: "AI service is not configured.",
      env: "AI_SERVICE_URL",
    });
    expect(graphql.statusCode).toBe(503);
    expect(graphql.json()).toEqual({
      error: "GraphQL proxy upstream is not configured.",
      env: "PROXY_GRAPHQL_UPSTREAM_URL",
    });
  });
});
