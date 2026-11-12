import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { Writable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { roleAllowsMethod } from "../src/lib/jwt.js";
import { rewriteUpstreamHeaders } from "../src/lib/upstream-headers.js";
import { TEST_GATEWAY_SECRET } from "./constants.js";
import { createGatewayApp } from "./create-gateway-app.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;
let upstream: Server | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
  if (upstream) {
    await new Promise<void>((resolve, reject) => {
      upstream?.close((error) => (error ? reject(error) : resolve()));
    });
    upstream = undefined;
  }
});

async function startUpstream() {
  const seen: IncomingHttpHeaders[] = [];
  upstream = createServer((request, response) => {
    seen.push(request.headers);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, method: request.method }));
  });
  await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as AddressInfo;
  return { seen, url: `http://127.0.0.1:${address.port}` };
}

describe("role policy", () => {
  it("lets viewers read, researchers write, and admins do everything", () => {
    expect(roleAllowsMethod("viewer", "GET")).toBe(true);
    expect(roleAllowsMethod("viewer", "POST")).toBe(false);
    expect(roleAllowsMethod("researcher", "PATCH")).toBe(true);
    expect(roleAllowsMethod("researcher", "DELETE")).toBe(false);
    expect(roleAllowsMethod("admin", "DELETE")).toBe(true);
  });

  it("replaces client identity headers with the verified user", () => {
    const headers = rewriteUpstreamHeaders(
      {
        authUser: {
          id: "user-1",
          email: "viewer@local",
          role: "viewer",
          expiresAt: "2026-10-21T16:00:00.000Z",
        },
      },
      { "x-user-role": "admin", authorization: "Bearer token" },
      TEST_GATEWAY_SECRET,
    );

    expect(headers["x-user-id"]).toBe("user-1");
    expect(headers["x-user-role"]).toBe("viewer");
    expect(headers["x-user-email"]).toBe("viewer@local");
    expect(headers["x-gateway-caller"]).toBe("team-2-gateway");
    expect(headers["x-gateway-secret"]).toBe(TEST_GATEWAY_SECRET);
  });
});

describe("gateway authentication", () => {
  it("proxies public registration and refuses role escalation fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      token: "signed", user: { id: "1", email: "new@example.com", role: "viewer" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    app = await createGatewayApp();
    const payload = { email: "new@example.com", password: "correct-password" };
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(response.statusCode).toBe(201);
    const call = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string>; body: string }] | undefined;
    expect(call?.[0].toString()).toBe("http://127.0.0.1:4004/register");
    expect(call?.[1].headers["x-gateway-secret"]).toBe(TEST_GATEWAY_SECRET);
    expect(JSON.parse(call?.[1].body ?? "{}")).toEqual(payload);
    expect((await app.inject({
      method: "POST", url: "/api/auth/register", payload: { ...payload, role: "admin" },
    })).statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("proxies login without a bearer token and forwards the gateway secret", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "signed", user: { id: "1", email: "viewer@local", role: "viewer" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    app = await createGatewayApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "viewer@local", password: "local-password" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ token: "signed" });
    const call = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string>; body: string }] | undefined;
    expect(call?.[0].toString()).toBe("http://127.0.0.1:4004/login");
    expect(call?.[1].headers["x-gateway-caller"]).toBe("team-2-gateway");
    expect(call?.[1].headers["x-gateway-secret"]).toBe(TEST_GATEWAY_SECRET);
    expect(JSON.parse(call?.[1].body ?? "{}")).toEqual({
      email: "viewer@local",
      password: "local-password",
    });
  });

  it("returns 502 when the jwt service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    app = await createGatewayApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "viewer@local", password: "local-password" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Gateway failed to reach the JWT service." });
  });

});
