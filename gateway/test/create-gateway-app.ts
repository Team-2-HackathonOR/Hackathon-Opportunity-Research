import type { Writable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { vi } from "vitest";

import { TEST_GATEWAY_SECRET } from "./constants.js";

const GATEWAY_ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "SERVICE_NAME",
  "LOG_LEVEL",
  "LOG_FILE_PATH",
  "HACKATHON_SERVICE_URL",
  "JWT_SERVICE_URL",
  "AI_SERVICE_URL",
  "SCRAPER_SERVICE_URL",
  "JWT_SECRET",
  "JWT_ISSUER",
  "GATEWAY_INTERNAL_SECRET",
  "ADMIN_API_KEY",
  "IP_ALLOWLIST",
  "IP_BLOCKLIST",
  "PATH_BLOCKLIST",
  "PROXY_GRAPHQL_UPSTREAM_URL",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
] as const;

type GatewayEnvKey = (typeof GATEWAY_ENV_KEYS)[number];
type EnvOverrides = Partial<Record<GatewayEnvKey, string | undefined>>;

export async function createGatewayApp(
  overrides: EnvOverrides = {},
  options: { logStream?: Writable } = {},
): Promise<FastifyInstance> {
  for (const key of GATEWAY_ENV_KEYS) {
    delete process.env[key];
  }

  const values: Record<string, string> = {
    NODE_ENV: "test",
    PORT: "4000",
    SERVICE_NAME: "team-2-gateway",
    LOG_LEVEL: "error",
    HACKATHON_SERVICE_URL: "http://127.0.0.1:4001",
    JWT_SERVICE_URL: "http://127.0.0.1:4004",
    GATEWAY_INTERNAL_SECRET: TEST_GATEWAY_SECRET,
    RATE_LIMIT_MAX: "1000",
    RATE_LIMIT_WINDOW_MS: "60000",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  vi.resetModules();
  const { buildApp } = await import("../src/app.js");
  return buildApp(options);
}
