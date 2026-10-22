import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayApp } from "./create-gateway-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
});

describe("health routes", () => {
  it("reports liveness without calling the hackathon service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    app = await createGatewayApp();

    const health = await app.inject({ method: "GET", url: "/health" });
    const live = await app.inject({ method: "GET", url: "/health/live" });

    expect(health.statusCode).toBe(200);
    const healthBody = health.json();
    expect(healthBody.ok).toBe(true);
    expect(healthBody.service).toBe("team-2-gateway");
    expect(healthBody.role).toBe("api-gateway");
    expect(typeof healthBody.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(healthBody.timestamp))).toBe(false);

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({
      ok: true,
      check: "liveness",
      service: "team-2-gateway",
      role: "api-gateway",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is ready when the hackathon service health check succeeds", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    app = await createGatewayApp({
      HACKATHON_SERVICE_URL: "http://127.0.0.1:4001/",
    });

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      check: "readiness",
      service: "team-2-gateway",
      role: "api-gateway",
      downstream: { hackathon_service: "ok", jwt_service: "ok" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4001/health/ready");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4004/health/ready");
  });

  it("returns 503 when the hackathon service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    app = await createGatewayApp();

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      check: "readiness",
      service: "team-2-gateway",
      role: "api-gateway",
      downstream: { hackathon_service: "unavailable", jwt_service: "unavailable" },
    });
  });

  it("returns 503 when the hackathon service answers but is not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 503 })),
    );
    app = await createGatewayApp();

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      downstream: { hackathon_service: "unavailable", jwt_service: "unavailable" },
    });
  });
});
