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

describe("gateway authorization", () => {
  it("requires a bearer token on hackathon routes and enforces roles", async () => {
    const fetchMock = stubTokenVerification();
    const { seen, url } = await startUpstream();
    app = await createGatewayApp({ HACKATHON_SERVICE_URL: url });
    const viewer = await signTestToken("viewer");
    const researcher = await signTestToken("researcher");
    const admin = await signTestToken("admin");

    const missing = await app.inject({ method: "GET", url: "/api/hackathons" });
    const expired = await app.inject({
      method: "GET",
      url: "/api/hackathons",
      headers: { authorization: `Bearer ${await signTestToken("viewer", { expiresInSeconds: -30 })}` },
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/hackathons",
      headers: { authorization: `Bearer ${viewer}` },
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/hackathons",
      headers: {
        authorization: `Bearer ${viewer}`,
        "x-user-role": "admin",
      },
    });
    const write = await app.inject({
      method: "POST",
      url: "/api/hackathons",
      headers: { authorization: `Bearer ${researcher}`, "content-type": "application/json" },
      payload: { event_name: "Demo" },
    });
    const remove = await app.inject({
      method: "DELETE",
      url: "/api/hackathons/1",
      headers: { authorization: `Bearer ${admin}` },
    });
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${viewer}` },
    });

    expect(missing.statusCode).toBe(401);
    expect(expired.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(write.statusCode).toBe(200);
    expect(remove.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      email: "viewer@local",
      role: "viewer",
    });
    expect(seen).toHaveLength(3);
    expect(seen[0]?.["x-user-role"]).toBe("viewer");
    expect(seen[0]?.["x-user-id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(seen[0]?.["x-gateway-caller"]).toBe("team-2-gateway");
    expect(seen[0]?.["x-gateway-secret"]).toBe(TEST_GATEWAY_SECRET);
    expect(seen[1]?.["x-user-role"]).toBe("researcher");
    expect(seen[2]?.["x-user-role"]).toBe("admin");
    const verifyCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/verify"));
    const verifyHeaders = new Headers((verifyCall?.[1] as RequestInit | undefined)?.headers);
    expect(verifyHeaders.get("x-gateway-caller")).toBe("team-2-gateway");
    expect(verifyHeaders.get("x-gateway-secret")).toBe(TEST_GATEWAY_SECRET);
  });

  it("lets an admin token use the admin API without the shared key", async () => {
    stubTokenVerification();
    app = await createGatewayApp();
    const token = await signTestToken("admin");

    const response = await app.inject({
      method: "GET",
      url: "/admin/access-control",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects a viewer token on the admin API", async () => {
    stubTokenVerification();
    app = await createGatewayApp({ ADMIN_API_KEY: "secret-key" });
    const token = await signTestToken("viewer");

    const response = await app.inject({
      method: "GET",
      url: "/admin/access-control",
      headers: { authorization: `Bearer ${token}`, "x-admin-key": "secret-key" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Admin role is required." });
  });
});
