import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    SERVICE_NAME: "hackathon-service",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://localhost/test",
    DATABASE_SSL: false,
    DB_POOL_MAX: 1,
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
  },
}));

import handler from "./app.js";

describe("Vercel entrypoint", () => {
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serves health requests through the default HTTP handler", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/health/live`),
      fetch(`${baseUrl}/health/live`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        service: "hackathon-service",
        check: "liveness",
      });
    }
  });

  it("preserves gateway authentication checks", async () => {
    const response = await fetch(`${baseUrl}/api/hackathons`);
    expect(response.status).toBe(403);
  });
});
