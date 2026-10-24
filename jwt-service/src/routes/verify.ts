import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { UserStore } from "../db/users.js";
import { authorizeAccessToken } from "../lib/authorize-token.js";

export function verifyRoutes(users: UserStore, tokens: TokenStore): FastifyPluginAsync {
  return async (app) => {
    app.post("/verify", async (request, reply) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ") || header.length <= "Bearer ".length) {
        return reply.code(401).send({ error: "Missing or invalid Authorization header." });
      }

      try {
        const session = await authorizeAccessToken(header.slice("Bearer ".length), {
          secret: env.JWT_SECRET,
          issuer: env.JWT_ISSUER,
          tokens,
          users,
        });
        return {
          id: session.id,
          email: session.email,
          role: session.role,
          expiresAt: session.expiresAt,
        };
      } catch {
        return reply.code(401).send({ error: "Invalid or expired token." });
      }
    });
  };
}
