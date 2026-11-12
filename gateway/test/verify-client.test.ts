import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("JWT verification diagnostics", () => {
  it.each([
    ["HTTP error", () => new Response("private upstream body", { status: 503 }), "upstream_http_error", 503],
    ["redirect", () => new Response(null, { status: 302 }), "upstream_http_error", 302],
    ["invalid JSON", () => new Response("private upstream body"), "invalid_json_or_response_read_failure", 200],
    ["invalid session", () => Response.json({ token: "private token" }), "invalid_session_payload", 200],
    ["network failure", () => { throw new Error("private connection details"); }, "network_error_or_timeout", undefined],
  ])("logs safe context for %s and denies access", async (_name, response, reason, status) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SERVICE_URL", "https://jwt.example.test");
    vi.stubEnv("GATEWAY_INTERNAL_SECRET", "fixture-gateway-secret");
    vi.resetModules();
    const { verifyBearer } = await import("../src/lib/verify-client.js");
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    const logger = { error: vi.fn() };
    expect(await verifyBearer("Bearer private-token", logger)).toEqual({ status: "unreachable" });
    expect(logger.error).toHaveBeenCalledWith({
      upstreamOrigin: "https://jwt.example.test",
      upstreamPath: "/verify",
      reason,
      upstreamStatus: status,
    }, "JWT session verification failed.");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      redirect: "manual", signal: expect.any(AbortSignal),
    }));
  });
});
