import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createGatewayApp } from "./create-gateway-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("access control", () => {
  it("blocks a listed IP and uses the first forwarded address", async () => {
    app = await createGatewayApp({
      IP_BLOCKLIST: "203.0.113.10",
      IP_ALLOWLIST: "203.0.113.10",
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.8" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "IP 203.0.113.10 is blocked." });
  });

  it("rejects an IP that is not on the allowlist", async () => {
    app = await createGatewayApp({
      IP_ALLOWLIST: "203.0.113.8",
    });

    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "198.51.100.20" },
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "203.0.113.8" },
    });

    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "IP 198.51.100.20 is not in allowlist." });
    expect(allowed.statusCode).toBe(200);
  });

  it("blocks a path and its children, including when a query string is present", async () => {
    app = await createGatewayApp({
      PATH_BLOCKLIST: "/secret/",
    });

    const blocked = await app.inject({ method: "GET", url: "/secret/child?x=1" });
    const sibling = await app.inject({ method: "GET", url: "/secrets" });
    const health = await app.inject({ method: "GET", url: "/health" });

    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "Path /secret/child is blocked." });
    expect(sibling.statusCode).not.toBe(403);
    expect(health.statusCode).toBe(200);
  });
});
