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

  it("accepts an invitation without a bearer token and keeps the token out of the logs", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const inviteToken = "invite-token-value-with-32-characters";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "signed", user: { id: "1", email: "new@example.com", role: "viewer" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    app = await createGatewayApp({ LOG_LEVEL: "info" }, { logStream: stream });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      headers: { "content-type": "application/json" },
      payload: { token: inviteToken, password: "new-password" },
    });

    expect(response.statusCode).toBe(200);
    const call = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string>; body: string }] | undefined;
    expect(call?.[0].toString()).toBe("http://127.0.0.1:4004/invitations/accept");
    expect(call?.[1].headers["x-gateway-caller"]).toBe("team-2-gateway");
    expect(call?.[1].headers["x-gateway-secret"]).toBe(TEST_GATEWAY_SECRET);
    expect(JSON.parse(call?.[1].body ?? "{}")).toEqual({ token: inviteToken, password: "new-password" });
    const logs = chunks.join("\n");
    expect(logs).not.toContain(inviteToken);
    expect(logs).not.toContain("new-password");
  });

  it("allows only an admin to create an invitation", async () => {
    const fetchMock = stubTokenVerification(async () =>
      new Response(JSON.stringify({ invitationId: "abc", inviteUrl: "http://localhost:3000/accept-invite?token=hidden" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    app = await createGatewayApp();
    const researcher = await signTestToken("researcher");
    const viewer = await signTestToken("viewer");
    const admin = await signTestToken("admin");

    const researcherResponse = await app.inject({
      method: "POST",
      url: "/api/auth/invitations",
      headers: { authorization: `Bearer ${researcher}`, "content-type": "application/json" },
      payload: { email: "new@example.com", role: "viewer" },
    });
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/invitations",
      headers: { authorization: `Bearer ${viewer}`, "content-type": "application/json" },
      payload: { email: "new@example.com", role: "viewer" },
    });
    const adminResponse = await app.inject({
      method: "POST",
      url: "/api/auth/invitations",
      headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
      payload: { email: "new@example.com", role: "viewer" },
    });

    expect(researcherResponse.statusCode).toBe(403);
    expect(researcherResponse.json()).toEqual({ error: "Admin role is required." });
    expect(viewerResponse.statusCode).toBe(403);
    expect(viewerResponse.json()).toEqual({ error: "This role cannot perform that action." });
    expect(adminResponse.statusCode).toBe(201);
    const invitationCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/invitations"));
    const headers = new Headers((invitationCall?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get("x-user-id")).toBe("11111111-1111-1111-1111-111111111111");
    expect(headers.get("x-user-role")).toBe("admin");
    expect(headers.get("x-gateway-secret")).toBe(TEST_GATEWAY_SECRET);
    expect(JSON.parse(String((invitationCall?.[1] as RequestInit | undefined)?.body))).toEqual({
      email: "new@example.com",
      role: "viewer",
    });
  });

  it("forwards logout with the bearer token and lets only an admin revoke sessions", async () => {
    const fetchMock = stubTokenVerification(async (url, init) => {
      if (url.endsWith("/logout")) {
        return new Response(JSON.stringify({ revoked: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/revoke-sessions")) {
        return new Response(JSON.stringify({ revoked: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected", url, hasBody: Boolean(init?.body) }), { status: 500 });
    });
    app = await createGatewayApp();
    const researcher = await signTestToken("researcher");
    const admin = await signTestToken("admin");

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${researcher}` },
    });
    const denied = await app.inject({
      method: "POST",
      url: "/api/auth/users/33333333-3333-3333-3333-333333333333/revoke-sessions",
      headers: { authorization: `Bearer ${researcher}` },
    });
    const revoked = await app.inject({
      method: "POST",
      url: "/api/auth/users/33333333-3333-3333-3333-333333333333/revoke-sessions",
      headers: { authorization: `Bearer ${admin}` },
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ revoked: true });
    expect(denied.statusCode).toBe(403);
    expect(revoked.statusCode).toBe(200);
    const logoutCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/logout"));
    const logoutHeaders = new Headers((logoutCall?.[1] as RequestInit | undefined)?.headers);
    expect(logoutHeaders.get("authorization")).toBe(`Bearer ${researcher}`);
    const revokeCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/revoke-sessions"));
    const revokeHeaders = new Headers((revokeCall?.[1] as RequestInit | undefined)?.headers);
    expect(revokeHeaders.get("x-user-role")).toBe("admin");
    expect(revokeHeaders.get("authorization")).toBeNull();
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
