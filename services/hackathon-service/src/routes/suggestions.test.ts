import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test", SERVICE_NAME: "hackathon-service", LOG_LEVEL: "silent",
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
  },
}));
vi.mock("../db/client.js", () => ({
  db: { execute: vi.fn() },
  checkDatabaseConnection: vi.fn(),
}));

import { db } from "../db/client.js";
import { buildApp } from "../app.js";
import { PgDialect } from "drizzle-orm/pg-core";

const headers = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
  "x-user-id": "11111111-1111-4111-8111-111111111111",
  "x-user-role": "admin",
};
const event = {
  event_name: "Community AI Weekend", organizer_name: "Community",
  official_website: "https://example.test/event", format: "virtual",
  event_start_date: "2027-01-15", description: "Build together.",
};
let app: FastifyInstance;
const execute = vi.mocked(db.execute);
function executedQuery() {
  const query = execute.mock.calls[0]![0];
  if (typeof query === "string") throw new Error("Expected parameterized SQL.");
  return new PgDialect().sqlToQuery(query.getSQL());
}

beforeEach(async () => {
  execute.mockReset();
  app = await buildApp();
});
afterEach(async () => { await app.close(); });

describe("PostgreSQL suggestions and moderation", () => {
  it("denies direct calls and non-admin queue/review calls before database access", async () => {
    expect((await app.inject({ url: "/api/admin/suggestions" })).statusCode).toBe(403);
    for (const role of ["viewer", "researcher"]) {
      expect((await app.inject({
        url: "/api/admin/suggestions", headers: { ...headers, "x-user-role": role },
      })).statusCode).toBe(403);
      expect((await app.inject({
        method: "POST", url: "/api/admin/suggestions/1/review",
        headers: { ...headers, "x-user-role": role },
        payload: { decision: "rejected", notes: "Not official" },
      })).statusCode).toBe(403);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts a gateway guest suggestion using parameterized SQL", async () => {
    execute.mockResolvedValue({ rows: [], command: "INSERT", rowCount: 1, oid: 0, fields: [] });
    const response = await app.inject({
      method: "POST", url: "/api/suggestions",
      headers: { ...headers, "x-user-role": "viewer", "x-user-id": "hackscout-guest" },
      payload: { event: "Example'; DROP TABLE events; --", website: "https://example.test" },
    });
    expect(response.statusCode).toBe(201);
    const query = executedQuery();
    expect(query.sql).not.toContain("DROP TABLE");
    expect(query.params).toContain("Example'; DROP TABLE events; --");
  });

  it("rejects unsafe URLs, bad decisions, dates, locations and IDs before queries", async () => {
    for (const website of ["javascript:alert(1)", "https://user:pass@example.test"]) {
      expect((await app.inject({
        method: "POST", url: "/api/suggestions", headers, payload: { event: "Test", website },
      })).statusCode).toBe(400);
    }
    for (const payload of [
      { decision: "rejected", notes: "" },
      { decision: "approved", event: {} },
      { decision: "approved", event: { ...event, event_start_date: "2027-02-30" } },
      { decision: "approved", event: { ...event, event_end_date: "2027-01-01" } },
      { decision: "approved", event: { ...event, format: "hybrid" } },
    ]) {
      expect((await app.inject({
        method: "POST", url: "/api/admin/suggestions/1/review", headers, payload,
      })).statusCode).toBe(400);
    }
    expect((await app.inject({
      method: "POST", url: "/api/admin/suggestions/9223372036854775808/review",
      headers, payload: { decision: "rejected", notes: "Not official" },
    })).statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns paginated queue including empty pages and escapes search wildcards", async () => {
    execute.mockResolvedValue({ rows: [{ total: 14, items: [] }], command: "SELECT", rowCount: 1, oid: 0, fields: [] });
    const response = await app.inject({
      url: "/api/admin/suggestions?status=pending&page=3&search=100%25_", headers,
    });
    expect(response.json()).toEqual({ total: 14, items: [], page: 3, pageSize: 12 });
    const query = executedQuery();
    expect(query.params).toContain("%100\\%\\_%");
    expect(query.params).toContain(24);
  });

  it("uses the atomic publication function and trusted reviewer, never a body reviewer", async () => {
    const review = { id: "1", status: "approved", published_event_id: "10" };
    execute.mockResolvedValue({ rows: [{ review }], command: "SELECT", rowCount: 1, oid: 0, fields: [] });
    const response = await app.inject({
      method: "POST", url: "/api/admin/suggestions/1/review", headers,
      payload: { decision: "approved", event, reviewer_id: "spoofed" },
    });
    expect(response.json()).toEqual(review);
    const query = executedQuery();
    expect(query.sql).toContain("public.moderate_event_suggestion");
    expect(query.params).toContain(headers["x-user-id"]);
    expect(query.params).not.toContain("spoofed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("maps missing, reviewed, duplicate and database failures explicitly", async () => {
    for (const [code, status] of [["P0002", 404], ["P0001", 409], ["23505", 409], ["08006", 500]] as const) {
      execute.mockRejectedValueOnce({ cause: { code } });
      const response = await app.inject({
        method: "POST", url: "/api/admin/suggestions/1/review", headers,
        payload: { decision: "rejected", notes: "Not official" },
      });
      expect(response.statusCode).toBe(status);
    }
  });

  it("cannot report approval success without a published event ID", async () => {
    execute.mockResolvedValue({
      rows: [{ review: { id: "1", status: "approved", published_event_id: null } }],
      command: "SELECT", rowCount: 1, oid: 0, fields: [],
    });
    expect((await app.inject({
      method: "POST", url: "/api/admin/suggestions/1/review", headers,
      payload: { decision: "approved", event },
    })).statusCode).toBe(502);
  });
});
