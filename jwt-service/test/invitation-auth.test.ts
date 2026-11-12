import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { createMemoryAccounts } from "./memory-accounts.js";

const gatewayHeaders = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
  "content-type": "application/json",
};
const adminHeaders = {
  ...gatewayHeaders,
  "x-user-id": "22222222-2222-2222-2222-222222222222",
  "x-user-role": "admin",
};
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createService() {
  const accounts = createMemoryAccounts();
  app = await buildApp({
    userStore: accounts.userStore,
    invitationStore: accounts.invitationStore,
    bcryptRounds: 4,
    dummyPasswordHash: await hashPassword("dummy-password", 4),
  });
  return app;
}

describe("invitation authorization", () => {
  it("requires an admin identity and the gateway caller", async () => {
    const service = await createService();

    const researcher = await service.inject({
      method: "POST",
      url: "/invitations",
      headers: { ...gatewayHeaders, "x-user-id": adminHeaders["x-user-id"], "x-user-role": "researcher" },
      payload: { email: "new.researcher@example.com", role: "viewer" },
    });
    const outsider = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: { "content-type": "application/json" },
      payload: { token: "a".repeat(32), password: "correct-password" },
    });
    const shortPassword = await service.inject({
      method: "POST",
      url: "/invitations/accept",
      headers: gatewayHeaders,
      payload: { token: "a".repeat(32), password: "short" },
    });

    expect(researcher.statusCode).toBe(403);
    expect(researcher.json()).toEqual({ error: "Admin role is required." });
    expect(outsider.statusCode).toBe(403);
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toMatchObject({ error: "Validation failed." });
  });
});
