import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../config/env.js", () => ({
  env: { NODE_ENV: "test", SERVICE_NAME: "hackathon-service", LOG_LEVEL: "silent", GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value" },
}));
vi.mock("../db/client.js", () => ({
  db: { select: vi.fn() }, checkDatabaseConnection: vi.fn(),
}));
import { db } from "../db/client.js";
import { buildApp } from "../app.js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

let app: FastifyInstance;
afterEach(async () => { await app?.close(); vi.clearAllMocks(); });
describe("listing cursor pagination", () => {
  it("uses a stable ID cursor, returns a continuation and leaves legacy shape unchanged", async () => {
    const limit = vi.fn().mockResolvedValue([{ eventId: 2 }, { eventId: 3 }, { eventId: 4 }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((_condition: SQL | undefined) => ({ orderBy }));
    vi.mocked(db.select).mockReturnValue({ from: () => ({ where }) } as never);
    app = await buildApp();
    const headers = {
      "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "test-gateway-secret-value",
      "x-user-id": "guest", "x-user-role": "viewer",
    };
    const response = await app.inject({ url: "/api/hackathons?limit=2&after_event_id=1", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ event_id: 2 }, { event_id: 3 }], count: 2, next_after_id: 3 });
    expect(limit).toHaveBeenLastCalledWith(3);
    const condition = where.mock.calls[0]![0];
    expect(condition).toBeDefined();
    expect(new PgDialect().sqlToQuery(condition!).params).toEqual([1]);
    limit.mockResolvedValue([{ eventId: 4 }]);
    const last = await app.inject({ url: "/api/hackathons?limit=2&after_event_id=3", headers });
    expect(last.json().next_after_id).toBeNull();
    const legacy = await app.inject({ url: "/api/hackathons?limit=2", headers });
    expect(legacy.json()).not.toHaveProperty("next_after_id");
  });
});
