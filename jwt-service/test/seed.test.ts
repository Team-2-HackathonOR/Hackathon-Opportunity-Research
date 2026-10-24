import { describe, expect, it } from "vitest";

import type { JwtEnv } from "../src/config/env.js";
import { seedAccountsFromEnv } from "../src/lib/seed.js";

function env(overrides: Partial<JwtEnv> = {}): JwtEnv {
  return {
    PORT: 4004,
    NODE_ENV: "test",
    SERVICE_NAME: "jwt-service",
    LOG_LEVEL: "error",
    LOG_FILE_PATH: undefined,
    DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5432/postgres",
    DATABASE_SSL: false,
    JWT_SECRET: "test-jwt-secret-at-least-32-characters",
    JWT_ISSUER: "team-2-gateway",
    JWT_TTL_SECONDS: 7200,
    INVITE_URL_BASE: "http://localhost:3000/accept-invite",
    INVITE_TTL_SECONDS: 604800,
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
    BCRYPT_ROUNDS: 4,
    SEED_VIEWER_EMAIL: undefined,
    SEED_VIEWER_PASSWORD: undefined,
    SEED_RESEARCHER_EMAIL: undefined,
    SEED_RESEARCHER_PASSWORD: undefined,
    SEED_ADMIN_EMAIL: undefined,
    SEED_ADMIN_PASSWORD: undefined,
    MAIL_SERVICE_URL: undefined,
    LDAP_URL: undefined,
    LDAP_BIND_DN: undefined,
    LDAP_BIND_PASSWORD: undefined,
    LDAP_BASE_DN: undefined,
    LDAP_USER_FILTER: "(mail={{email}})",
    LDAP_GROUP_ADMIN: undefined,
    LDAP_GROUP_RESEARCHER: undefined,
    LDAP_GROUP_VIEWER: undefined,
    AUTH_DATABASE_URL: undefined,
    ...overrides,
  };
}

describe("seedAccountsFromEnv", () => {
  it("returns no accounts when seed passwords are unset", () => {
    expect(seedAccountsFromEnv(env({ SEED_VIEWER_EMAIL: "viewer@local" }))).toEqual([]);
  });

  it("keeps only complete accounts and normalizes email", () => {
    const accounts = seedAccountsFromEnv(
      env({
        SEED_VIEWER_EMAIL: " Viewer@Local ",
        SEED_VIEWER_PASSWORD: "viewer-password",
        SEED_ADMIN_EMAIL: "admin@local",
        SEED_ADMIN_PASSWORD: "admin-password",
      }),
    );

    expect(accounts).toEqual([
      { email: "viewer@local", password: "viewer-password", role: "viewer" },
      { email: "admin@local", password: "admin-password", role: "admin" },
    ]);
  });
});
