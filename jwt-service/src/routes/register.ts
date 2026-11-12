import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { RegistrationStore } from "../db/users.js";
import { hashPassword } from "../lib/password.js";
import { issueSession } from "../lib/session.js";

const registrationBody = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(8).refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be at most 72 UTF-8 bytes.",
  }),
}).strict();

export function registrationRoutes(
  store: RegistrationStore | undefined,
  tokens: TokenStore,
  bcryptRounds: number,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/register", async (request, reply) => {
      const parsed = registrationBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation failed.", details: parsed.error.flatten() });
      }
      if (!store) return reply.code(503).send({ error: "Account registration is unavailable." });

      const passwordHash = await hashPassword(parsed.data.password, bcryptRounds);
      const user = await store.createViewer(parsed.data.email.toLowerCase(), passwordHash);
      if (!user) {
        return reply.code(409).send({ error: "An account with this email already exists. Sign in instead." });
      }
      const session = await issueSession(user, tokens, {
        secret: env.JWT_SECRET,
        issuer: env.JWT_ISSUER,
        ttlSeconds: env.JWT_TTL_SECONDS,
      });
      return reply.code(201).send(session);
    });
  };
}
