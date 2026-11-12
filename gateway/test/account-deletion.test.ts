import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayApp } from "./create-gateway-app.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;
afterEach(async () => { vi.unstubAllGlobals(); await app?.close(); app = undefined; });
const payload = { password: "correct-password", confirmation: "DELETE" };

describe("self-service account data deletion", () => {
  it("allows viewers to delete only their own data after password verification", async () => {
    app = await createGatewayApp();
    const token = await signTestToken("viewer");
    const calls: string[] = [];
    stubTokenVerification((url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/api/account-data") {
        expect(init?.method).toBe("DELETE");
        const headers = new Headers(init?.headers);
        expect(headers.get("x-user-id")).not.toBe("spoofed");
        expect(headers.get("x-user-role")).toBe("viewer");
        expect(headers.get("x-user-email")).toBeTruthy();
        return Response.json({ deleted: true });
      }
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      return Response.json(path.endsWith("verify-password") ? { verified: true } : { deleted: true });
    });
    const response = await app.inject({
      method: "DELETE", url: "/api/auth/account",
      headers: { authorization: `Bearer ${token}`, "x-user-id": "spoofed", "x-user-role": "admin" }, payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(calls).toEqual(["/account/verify-password", "/api/account-data", "/account/delete"]);
  });
  it("does not clean up data for anonymous users, wrong passwords or client-supplied target IDs", async () => {
    app = await createGatewayApp();
    expect((await app.inject({ method: "DELETE", url: "/api/auth/account", payload })).statusCode).toBe(401);
    const token = await signTestToken("viewer");
    const calls: string[] = [];
    stubTokenVerification((url) => {
      calls.push(new URL(url).pathname);
      return Response.json({ error: "The current password is incorrect." }, { status: 403 });
    });
    const response = await app.inject({
      method: "DELETE", url: "/api/auth/account", headers: { authorization: `Bearer ${token}` }, payload,
    });
    expect(response.statusCode).toBe(403);
    expect(calls).toEqual(["/account/verify-password"]);
    expect((await app.inject({
      method: "DELETE", url: "/api/auth/account", headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, id: "another-user" },
    })).statusCode).toBe(400);
  });
  it("keeps the account when linked-data cleanup fails", async () => {
    app = await createGatewayApp();
    const token = await signTestToken("admin");
    const calls: string[] = [];
    stubTokenVerification((url) => {
      const path = new URL(url).pathname; calls.push(path);
      return Response.json(path.endsWith("verify-password") ? { verified: true } : { error: "Database unavailable." },
        { status: path.endsWith("verify-password") ? 200 : 500 });
    });
    const response = await app.inject({
      method: "DELETE", url: "/api/auth/account", headers: { authorization: `Bearer ${token}` }, payload,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatch(/still active/);
    expect(calls).toEqual(["/account/verify-password", "/api/account-data"]);
  });
});
