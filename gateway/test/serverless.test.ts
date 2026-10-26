import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayApp } from "./create-gateway-app.js";

describe("Vercel entrypoint", () => {
  let handler: typeof import("../src/app.js").default;
  let baseUrl: string;
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });

  beforeAll(async () => {
    const app = await createGatewayApp();
    await app.close();
    handler = (await import("../src/app.js")).default;
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

  it("serves concurrent health requests through the default handler", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/health/live`),
      fetch(`${baseUrl}/health/live`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        service: "team-2-gateway",
        role: "api-gateway",
      });
    }
  });

  it("preserves authentication on proxied routes", async () => {
    const response = await fetch(`${baseUrl}/api/hackathons`);
    expect(response.status).toBe(401);
  });
});
