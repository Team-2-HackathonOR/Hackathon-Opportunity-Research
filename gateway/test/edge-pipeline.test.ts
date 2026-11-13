import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { createGatewayApp } from "./create-gateway-app.js";
import { TEST_GATEWAY_SECRET } from "./constants.js";
import { signTestToken } from "./tokens.js";
import { stubTokenVerification } from "./verify-mock.js";

let server: Server | undefined;
let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
});
it("routes admin controls directly to Edge, preserves function prefixes, and authenticates cron at gateway", async () => {
  const seen: { path: string; secret: string | string[] | undefined; caller: string | string[] | undefined }[] = [];
  server = createServer((request, response) => {
    seen.push({ path: request.url ?? "", secret: request.headers["x-gateway-secret"], caller: request.headers["x-gateway-caller"] });
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/functions/v1`;
  app = await createGatewayApp({
    PIPELINE_SERVICE_URL: `${base}/scraper`, SCRAPER_SERVICE_URL: `${base}/scraper`, ETL_SERVICE_URL: `${base}/etl`,
    HACKSCOUT_SERVICE_URL: "http://127.0.0.1:1",
  });
  expect((await app.inject({ url: "/api/hackscout/admin/pipeline" })).statusCode).toBe(401);
  const internal = { "x-gateway-secret": TEST_GATEWAY_SECRET, "x-gateway-caller": "team-2-gateway" };
  const tick = "/api/internal/pipeline-worker/pipeline/tick";
  expect((await app.inject({ method: "POST", url: tick, payload: {} })).statusCode).toBe(403);
  expect((await app.inject({ method: "GET", url: tick, headers: internal })).statusCode).toBe(403);
  expect((await app.inject({ method: "POST", url: tick, headers: { ...internal, "x-gateway-secret": "spoofed" }, payload: {} })).statusCode).toBe(403);
  expect(seen).toHaveLength(0);
  expect((await app.inject({ method: "POST", url: tick, headers: internal, payload: {} })).statusCode).toBe(200);
  const viewer = await signTestToken("viewer");
  stubTokenVerification();
  expect((await app.inject({
    url: "/api/hackscout/admin/pipeline", headers: { authorization: `Bearer ${viewer}` },
  })).statusCode).toBe(403);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/cancel",
    headers: { authorization: `Bearer ${viewer}` }, payload: { jobId: "fixture" },
  })).statusCode).toBe(403);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/restart",
    headers: { authorization: `Bearer ${viewer}` }, payload: { jobId: "fixture", apiKey: "fixture" },
  })).statusCode).toBe(403);
  const admin = await signTestToken("admin");
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/continue",
    headers: { authorization: `Bearer ${viewer}` }, payload: { jobId: "fixture", apiKey: "fixture" },
  })).statusCode).toBe(403);
  const headers = { authorization: `Bearer ${admin}` };
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/clear",
    headers: { authorization: `Bearer ${viewer}` }, payload: { jobId: null, confirmation: "CLEAR ALL" },
  })).statusCode).toBe(403);
  expect((await app.inject({ url: "/api/hackscout/admin/pipeline", headers })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/hackscout/admin/pipeline/schedule", headers })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/cancel", headers, payload: { jobId: "fixture" },
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/restart", headers, payload: { jobId: "fixture", apiKey: "fixture" },
  })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/etl/events", headers, payload: { event_name: "Test" } })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/continue", headers, payload: { jobId: "fixture", apiKey: "fixture" },
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/hackscout/admin/pipeline/clear", headers, payload: { jobId: null, confirmation: "CLEAR ALL" },
  })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/scraper/hackathons?page=1", headers })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/internal/etl/etl/import/mongodb", headers: internal, payload: { limit: 1 },
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "POST", url: "/api/internal/etl/etl/import/storage", headers: internal, payload: { limit: 1 },
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "GET", url: "/api/internal/etl/etl/import/storage", headers: internal,
  })).statusCode).toBe(403);
  expect((await app.inject({
    method: "POST", url: "/api/internal/etl/etl/import/storage", payload: { limit: 1 },
  })).statusCode).toBe(403);
  expect(seen.map((v) => v.path)).toEqual([
    "/functions/v1/scraper/pipeline/tick", "/functions/v1/scraper/pipeline",
    "/functions/v1/scraper/pipeline/schedule", "/functions/v1/scraper/pipeline/cancel",
    "/functions/v1/scraper/pipeline/restart", "/functions/v1/etl/events",
    "/functions/v1/scraper/pipeline/continue", "/functions/v1/scraper/pipeline/clear",
    "/functions/v1/scraper/hackathons?page=1", "/functions/v1/etl/etl/import/mongodb", "/functions/v1/etl/etl/import/storage",
  ]);
  expect(seen.every((v) => v.secret === TEST_GATEWAY_SECRET && v.caller === "team-2-gateway")).toBe(true);
});
