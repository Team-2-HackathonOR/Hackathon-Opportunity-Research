import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("applies defaults when values are missing", () => {
    const env = loadEnv({});

    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.SERVICE_NAME).toBe("team-2-gateway");
    expect(env.HACKATHON_SERVICE_URL).toBe("http://127.0.0.1:4001");
    expect(env.JWT_SERVICE_URL).toBe("http://127.0.0.1:4004");
    expect(env.GATEWAY_INTERNAL_SECRET).toBeUndefined();
    expect(env.IP_BLOCKLIST).toEqual([]);
    expect(env.PATH_BLOCKLIST).toEqual([]);
    expect(env.IP_ALLOWLIST).toEqual([]);
    expect(env.AI_SERVICE_URL).toBeUndefined();
    expect(env.PROXY_GRAPHQL_UPSTREAM_URL).toBeUndefined();
    expect(env.LOG_FILE_PATH).toBeUndefined();
  });

  it("treats a blank log path as unset and keeps a real path", () => {
    expect(loadEnv({ LOG_FILE_PATH: "  " }).LOG_FILE_PATH).toBeUndefined();
    expect(loadEnv({ LOG_FILE_PATH: " logs/gateway.log " }).LOG_FILE_PATH).toBe("logs/gateway.log");
  });

  it("parses numbers and comma-separated lists", () => {
    const env = loadEnv({
      PORT: "4100",
      IP_BLOCKLIST: " 203.0.113.1, , 203.0.113.2 ",
      PATH_BLOCKLIST: "/admin,/internal",
    });

    expect(env.PORT).toBe(4100);
    expect(env.IP_BLOCKLIST).toEqual(["203.0.113.1", "203.0.113.2"]);
    expect(env.PATH_BLOCKLIST).toEqual(["/admin", "/internal"]);
  });

  it("rejects a hackathon service URL that is not a URL", () => {
    expect(() => loadEnv({ HACKATHON_SERVICE_URL: "not-a-url" })).toThrow();
  });

  it("requires the gateway secret in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
      }),
    ).not.toThrow();
  });
});
