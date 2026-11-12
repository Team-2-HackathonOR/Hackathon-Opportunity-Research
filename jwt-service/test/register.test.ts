import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppUser, RegistrationStore, UserStore } from "../src/db/users.js";
import { hashPassword } from "../src/lib/password.js";

const headers = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": "test-gateway-secret-value",
};
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function createApp() {
  const users: AppUser[] = [];
  const createViewer = vi.fn(async (email: string, passwordHash: string) => {
    if (users.some((user) => user.email === email)) return null;
    const user: AppUser = {
      id: crypto.randomUUID(), email, passwordHash, role: "viewer", authSource: "local", ldapDn: null,
    };
    users.push(user);
    return user;
  });
  const store: UserStore & RegistrationStore = {
    findByEmail: async (email) => users.find((user) => user.email === email) ?? null,
    findById: async (id) => users.find((user) => user.id === id) ?? null,
    createViewer,
  };
  app = await buildApp({
    userStore: store, registrationStore: store, bcryptRounds: 4,
    dummyPasswordHash: await hashPassword("dummy-password", 4),
  });
  return { service: app, users, createViewer };
}

describe("public registration", () => {
  it("creates a hashed viewer account with a usable session and subsequent login", async () => {
    const { service, users } = await createApp();
    const response = await service.inject({
      method: "POST", url: "/register", headers,
      payload: { email: " New@Example.com ", password: "correct-password" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ email: "new@example.com", role: "viewer" });
    expect(response.json().passwordHash).toBeUndefined();
    expect(users[0]?.passwordHash).not.toBe("correct-password");
    expect(await bcrypt.compare("correct-password", users[0]?.passwordHash ?? "")).toBe(true);
    const verified = await service.inject({
      method: "POST", url: "/verify",
      headers: { ...headers, authorization: `Bearer ${response.json().token}` },
    });
    expect(verified.statusCode).toBe(200);
    const login = await service.inject({
      method: "POST", url: "/login", headers,
      payload: { email: "new@example.com", password: "correct-password" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("does not replace an existing account or accept privilege fields", async () => {
    const { service, users, createViewer } = await createApp();
    const input = { email: "new@example.com", password: "correct-password" };
    await service.inject({ method: "POST", url: "/register", headers, payload: input });
    const originalHash = users[0]?.passwordHash;
    const duplicate = await service.inject({
      method: "POST", url: "/register", headers, payload: { ...input, password: "different-password" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(users).toHaveLength(1);
    expect(users[0]?.passwordHash).toBe(originalHash);
    const privileged = await service.inject({
      method: "POST", url: "/register", headers, payload: { ...input, role: "admin" },
    });
    expect(privileged.statusCode).toBe(400);
    expect(createViewer).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid input and direct calls without creating accounts", async () => {
    const { service, createViewer } = await createApp();
    for (const payload of [
      { email: "not-email", password: "correct-password" },
      { email: "new@example.com", password: "short" },
      { email: "new@example.com", password: "\u754c".repeat(25) },
    ]) {
      expect((await service.inject({ method: "POST", url: "/register", headers, payload })).statusCode).toBe(400);
    }
    expect((await service.inject({
      method: "POST", url: "/register",
      payload: { email: "new@example.com", password: "correct-password" },
    })).statusCode).toBe(403);
    expect(createViewer).not.toHaveBeenCalled();
  });
});
