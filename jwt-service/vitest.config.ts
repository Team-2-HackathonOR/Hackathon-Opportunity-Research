import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      PORT: "4004",
      DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5432/postgres",
      DATABASE_SSL: "false",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters",
      JWT_ISSUER: "team-2-gateway",
      JWT_TTL_SECONDS: "7200",
      GATEWAY_INTERNAL_SECRET: "test-gateway-secret-value",
      BCRYPT_ROUNDS: "4",
    },
  },
});
