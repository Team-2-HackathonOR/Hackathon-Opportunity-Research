import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { AdminSetupStore, UserStore } from "../db/users.js";
import { hashPassword } from "../lib/password.js";
import { issueSession } from "../lib/session.js";

const emailBody = z.object({ email: z.string().trim().max(254).email().transform((email) => email.toLowerCase()) }).strict();
const passwordBody = emailBody.extend({
  password: z.string().min(8).refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be at most 72 UTF-8 bytes.",
  }),
}).strict();

export function adminAccessRoutes(
  users: UserStore, setup: AdminSetupStore | undefined, tokens: TokenStore, bcryptRounds: number,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/admin/access", async (request, reply) => {
      const parsed = emailBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Enter a valid administrator email." });
      const user = await users.findByEmail(parsed.data.email);
      if (!user || user.role !== "admin") {
        return reply.code(403).send({ error: "This account is not approved for administrator access." });
      }
      return { email: user.email, passwordSetupRequired: user.authSource === "local" && user.passwordHash === null };
    });
    app.post("/admin/create-password", async (request, reply) => {
      const parsed = passwordBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Enter a valid email and a password of at least 8 characters and at most 72 UTF-8 bytes." });
      if (!setup) return reply.code(503).send({ error: "Administrator password setup is unavailable." });
      const existing = await users.findByEmail(parsed.data.email);
      if (!existing || existing.role !== "admin") {
        return reply.code(403).send({ error: "This account is not approved for administrator access." });
      }
      if (existing.authSource !== "local" || existing.passwordHash !== null) {
        return reply.code(409).send({ error: "This account already has sign-in credentials. Sign in instead." });
      }
      const user = await setup.setInitialAdminPassword(parsed.data.email, await hashPassword(parsed.data.password, bcryptRounds));
      if (!user) return reply.code(409).send({ error: "Password setup is no longer available. Sign in instead." });
      return issueSession(user, tokens, {
        secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, ttlSeconds: env.JWT_TTL_SECONDS,
      });
    });
  };
}
