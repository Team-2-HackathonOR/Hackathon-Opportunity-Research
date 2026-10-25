import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/runtime.js", () => ({
  createRuntime: vi.fn(async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({
      userStore: {
        async findByEmail() { return null; },
        async findById() { return null; },
      },
      checkDatabase: async () => true,
    });
    await app.ready();
    return { app };
  }),
}));

import handler from "../src/app.js";
import { createRuntime } from "../src/runtime.js";

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

  it("initializes once for concurrent requests and exposes database readiness", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/health/ready`),
      fetch(`${baseUrl}/health/ready`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, database: "ok" });
    }
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it("preserves gateway authentication checks", async () => {
    const response = await fetch(`${baseUrl}/login`, { method: "POST" });
    expect(response.status).toBe(403);
  });
});
