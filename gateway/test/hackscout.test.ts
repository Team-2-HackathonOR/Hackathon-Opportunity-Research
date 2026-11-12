import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayApp } from "./create-gateway-app.js";
import { TEST_GATEWAY_SECRET } from "./constants.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let app: FastifyInstance | undefined;
let backend: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
  if (backend) await new Promise<void>((resolve) => backend?.close(() => resolve()));
  backend = undefined;
});

async function startBackend() {
  const seen: { path: string; secret: string | string[] | undefined; id: string | string[] | undefined; role: string | string[] | undefined; body: string }[] = [];
  backend = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push({
        path: request.url ?? "", secret: request.headers["x-gateway-secret"],
        id: request.headers["x-user-id"],
        role: request.headers["x-user-role"], body,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => backend?.listen(0, "127.0.0.1", resolve));
  const address = backend.address() as AddressInfo;
  return { seen, base: `http://127.0.0.1:${address.port}` };
}

describe("gateway-only HackScout routing", () => {
  it("routes guest reads and suggestions through the limiter and replaces spoofed identity", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ HACKATHON_SERVICE_URL: base, HACKSCOUT_SERVICE_URL: base });
    const listings = await app.inject({
      method: "GET", url: "/api/hackscout/hackathons?limit=100&include=details",
      headers: { "x-user-id": "spoofed", "x-user-role": "admin", "x-gateway-secret": "spoofed" },
    });
    expect(listings.statusCode).toBe(200);
    expect(seen[0]).toMatchObject({
      path: "/api/hackathons?limit=100&include=details",
      secret: TEST_GATEWAY_SECRET, id: "hackscout-guest", role: "viewer",
    });
    expect((await app.inject({
      method: "GET", url: "/api/hackscout/hackathons/views/shortlist",
    })).statusCode).toBe(401);
    expect(seen).toHaveLength(1);
    expect((await app.inject({
      method: "POST", url: "/api/hackscout/suggestions", payload: { event: "Example" },
    })).statusCode).toBe(200);
    expect(seen[1]?.path).toBe("/api/suggestions");
  });

  it("rate limits guest requests before forwarding them", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ HACKATHON_SERVICE_URL: base, RATE_LIMIT_MAX: "2" });
    await app.ready();
    for (let i = 0; i < 2; i += 1) {
      expect((await app.inject({ method: "GET", url: "/api/hackscout/hackathons" })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/api/hackscout/hackathons" })).statusCode).toBe(429);
    expect(seen).toHaveLength(2);
  });

  it("routes and rate limits public admin login at 30 requests per minute", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ HACKSCOUT_SERVICE_URL: base });
    for (let i = 0; i < 30; i += 1) {
      expect((await app.inject({
        method: "POST", url: "/api/hackscout/admin/login",
        payload: { email: "admin@local", password: "fixture-password" },
      })).statusCode).toBe(200);
    }
    expect((await app.inject({
      method: "POST", url: "/api/hackscout/admin/login",
      payload: { email: "admin@local", password: "fixture-password" },
    })).statusCode).toBe(429);
    expect(seen).toHaveLength(30);
    expect(seen[0]?.path).toBe("/api/admin/login");
  });

  it("requires an admin token for the admin API, including reads", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ HACKSCOUT_SERVICE_URL: base });
    expect((await app.inject({ method: "GET", url: "/api/hackscout/admin/pipeline" })).statusCode).toBe(401);
    const viewer = await signTestToken("viewer");
    stubTokenVerification();
    expect((await app.inject({
      method: "GET", url: "/api/hackscout/admin/pipeline", headers: { authorization: `Bearer ${viewer}` },
    })).statusCode).toBe(403);
    const admin = await signTestToken("admin");
    stubTokenVerification();
    expect((await app.inject({
      method: "GET", url: "/api/hackscout/admin/pipeline", headers: { authorization: `Bearer ${admin}` },
    })).statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.role).toBe("admin");
  });

  it("proxies pipeline stages only for internal callers and rejects other internal paths", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ SCRAPER_SERVICE_URL: base, ETL_SERVICE_URL: base });
    const path = "/api/internal/scraper/hackathons/persist-all";
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(403);
    const headers = { "x-gateway-secret": TEST_GATEWAY_SECRET, "x-gateway-caller": "team-2-gateway", "x-ai-api-key": "fixture" };
    expect((await app.inject({ method: "GET", url: `${path}?startPage=1`, headers })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST", url: "/api/internal/etl/etl/import/mongodb", headers,
      payload: { limit: null, fetched_at: "run" },
    })).statusCode).toBe(200);
    expect(seen.map((item) => item.path)).toEqual(["/hackathons/persist-all?startPage=1", "/etl/import/mongodb"]);
    expect((await app.inject({
      method: "GET", url: "/api/internal/scraper/hackathons/cache", headers,
    })).statusCode).toBe(403);
  });

  it("routes manual ETL operations for admins and strips the scraper prefix", async () => {
    const { seen, base } = await startBackend();
    app = await createGatewayApp({ SCRAPER_SERVICE_URL: base, ETL_SERVICE_URL: base });
    stubTokenVerification();
    const viewer = await signTestToken("viewer");
    expect((await app.inject({
      method: "GET", url: "/api/etl/events", headers: { authorization: `Bearer ${viewer}` },
    })).statusCode).toBe(403);
    const admin = await signTestToken("admin");
    const headers = { authorization: `Bearer ${admin}` };
    expect((await app.inject({
      method: "POST", url: "/api/etl/events", headers, payload: { event_name: "Example" },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET", url: "/api/scraper/hackathons", headers,
    })).statusCode).toBe(200);
    expect(seen.map((item) => item.path)).toEqual(["/events", "/hackathons"]);
    expect(seen.every((item) => item.secret === TEST_GATEWAY_SECRET)).toBe(true);
  });
});
