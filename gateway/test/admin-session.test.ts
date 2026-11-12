import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayApp } from "./create-gateway-app.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;
afterEach(async () => { vi.unstubAllGlobals(); await app?.close(); app = undefined; });
const prefix = "/api/hackscout/admin/auth";
const headers = { "x-hackscout-admin": "1" };
const payload = { email: "admin@example.test", password: "correct-password" };

describe("HttpOnly administrator sessions", () => {
  it("forwards email checks and keeps authentication tokens out of browser responses", async () => {
    app = await createGatewayApp();
    const token = await signTestToken("admin");
    const calls: string[] = [];
    stubTokenVerification((url, init) => {
      calls.push(new URL(url).pathname);
      expect(new Headers(init?.headers).get("x-gateway-secret")).toBeTruthy();
      return Response.json(url.endsWith("/admin/access")
        ? { email: payload.email, passwordSetupRequired: true } : { token });
    });
    const access = await app.inject({ method: "POST", url: `${prefix}/access`, headers, payload: { email: payload.email } });
    expect(access.json()).toEqual({ email: payload.email, passwordSetupRequired: true });
    for (const action of ["login", "create-password"]) {
      const response = await app.inject({ method: "POST", url: `${prefix}/${action}`, headers, payload });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty("token");
      expect(response.json().user.role).toBe("admin");
      expect(response.headers["set-cookie"]).toContain("HttpOnly; SameSite=Lax; Max-Age=");
      expect(response.headers["set-cookie"]).toContain("Path=/api/hackscout/admin");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(calls).toEqual(["/admin/access", "/login", "/admin/create-password"]);
    const session = await app.inject({
      method: "GET", url: `${prefix}/session`, headers: { cookie: `hackscout_admin=${token}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.role).toBe("admin");
    // Administrator cookies must not authenticate unrelated API surfaces.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `hackscout_admin=${token}` } })).statusCode).toBe(401);
  });
  it("requires the same-origin request header for login, activation and cookie mutations", async () => {
    app = await createGatewayApp();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const action of ["access", "login", "create-password"]) {
      expect((await app.inject({ method: "POST", url: `${prefix}/${action}`, payload })).statusCode).toBe(403);
    }
    expect((await app.inject({
      method: "POST", url: "/api/hackscout/admin/pipeline/run",
      headers: { cookie: "hackscout_admin=fake" }, payload: { apiKey: "fixture" },
    })).statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("revokes nonadmin logins and refuses invalid, expired or nonadmin cookie sessions", async () => {
    app = await createGatewayApp();
    const token = await signTestToken("viewer");
    const calls: string[] = [];
    stubTokenVerification((url) => {
      calls.push(new URL(url).pathname);
      return Response.json(url.endsWith("/login") ? { token } : { ok: true });
    });
    const response = await app.inject({ method: "POST", url: `${prefix}/login`, headers, payload });
    expect(response.statusCode).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(calls).toEqual(["/login", "/logout"]);
    expect((await app.inject({
      method: "GET", url: `${prefix}/session`, headers: { cookie: `hackscout_admin=${token}` },
    })).statusCode).toBe(403);
    const invalid = await app.inject({ method: "GET", url: `${prefix}/session`, headers: { cookie: "hackscout_admin=invalid" } });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.headers["set-cookie"]).toContain("Max-Age=0");
  });
  it("expires the cookie and revokes the underlying server session on logout", async () => {
    app = await createGatewayApp();
    const token = await signTestToken("admin");
    let revoked = false;
    stubTokenVerification((url, init) => {
      expect(url).toMatch(/\/logout$/);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      revoked = true;
      return Response.json({ ok: true });
    });
    const logout = await app.inject({
      method: "POST", url: `${prefix}/logout`, headers: { ...headers, cookie: `hackscout_admin=${token}` }, payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(revoked).toBe(true);
  });
  it("uses Secure cookies in production and reports authentication outages explicitly", async () => {
    app = await createGatewayApp({ NODE_ENV: "production" });
    const token = await signTestToken("admin");
    stubTokenVerification(() => Response.json({ token }));
    expect((await app.inject({ method: "POST", url: `${prefix}/login`, headers, payload })).headers["set-cookie"]).toContain("; Secure");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")));
    const response = await app.inject({ method: "POST", url: `${prefix}/access`, headers, payload: { email: payload.email } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatch(/unavailable/);
  });
});
