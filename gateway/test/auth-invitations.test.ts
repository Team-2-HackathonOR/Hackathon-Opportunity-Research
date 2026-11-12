import { Writable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEST_GATEWAY_SECRET } from "./constants.js";
import { createGatewayApp } from "./create-gateway-app.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
});

const gatewayHeaders = {
  "content-type": "application/json",
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": TEST_GATEWAY_SECRET,
};
const adminHeaders = {
  ...gatewayHeaders,
  "x-user-id": "22222222-2222-2222-2222-222222222222",
  "x-user-role": "admin",
};
describe("gateway invitation and session routes", () => {
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

});
