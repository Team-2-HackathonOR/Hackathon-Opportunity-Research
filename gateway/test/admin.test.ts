import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createGatewayApp } from "./create-gateway-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function adminHeaders(key = "secret-key"): Record<string, string> {
  return {
    "x-admin-key": key,
    "content-type": "application/json",
  };
}

describe("admin access control", () => {
  it("stays disabled until an admin key is configured", async () => {
    app = await createGatewayApp();

    const response = await app.inject({ method: "GET", url: "/admin/access-control" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Admin API is disabled. Set ADMIN_API_KEY to enable.",
    });
  });

  it("rejects a missing or wrong admin key", async () => {
    app = await createGatewayApp({ ADMIN_API_KEY: "secret-key" });

    const missing = await app.inject({ method: "GET", url: "/admin/access-control" });
    const wrong = await app.inject({
      method: "GET",
      url: "/admin/access-control",
      headers: { "x-admin-key": "nope" },
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "Invalid admin key." });
  });

  it("lists each block once and enforces blocks added at runtime", async () => {
    app = await createGatewayApp({
      ADMIN_API_KEY: "secret-key",
      IP_BLOCKLIST: "198.51.100.9",
      PATH_BLOCKLIST: "/env-blocked",
    });

    const snapshot = await app.inject({
      method: "GET",
      url: "/admin/access-control",
      headers: adminHeaders(),
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      ip_allowlist: [],
      ip_blocklist: ["198.51.100.9"],
      path_blocklist: ["/env-blocked"],
    });

    const duplicateIp = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-ip",
      headers: adminHeaders(),
      payload: JSON.stringify({ ip: "198.51.100.9" }),
    });
    expect(duplicateIp.statusCode).toBe(200);

    const blockedIp = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-ip",
      headers: adminHeaders(),
      payload: JSON.stringify({ ip: "203.0.113.5" }),
    });
    expect(blockedIp.json()).toEqual({ ok: true, blocked_ip: "203.0.113.5" });

    const blockedPath = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-path",
      headers: adminHeaders(),
      payload: JSON.stringify({ path: "/secret" }),
    });
    expect(blockedPath.json()).toEqual({ ok: true, blocked_path: "/secret" });

    const after = await app.inject({
      method: "GET",
      url: "/admin/access-control",
      headers: adminHeaders(),
    });
    expect(after.json()).toMatchObject({
      ip_blocklist: ["198.51.100.9", "203.0.113.5"],
      path_blocklist: ["/env-blocked", "/secret"],
    });

    const deniedIp = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    const deniedPath = await app.inject({ method: "GET", url: "/secret" });
    const deniedEnvPath = await app.inject({ method: "GET", url: "/env-blocked/item" });
    const allowed = await app.inject({ method: "GET", url: "/health" });

    expect(deniedIp.statusCode).toBe(403);
    expect(deniedPath.statusCode).toBe(403);
    expect(deniedEnvPath.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
  });

  it("returns 400 when a block request has no path or ip", async () => {
    app = await createGatewayApp({ ADMIN_API_KEY: "secret-key" });

    const response = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-path",
      headers: adminHeaders(),
      payload: JSON.stringify({}),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Validation failed." });
  });
});
