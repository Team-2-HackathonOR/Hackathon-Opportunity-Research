import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { UserStore } from "../db/users.js";
import { authorizeAccessToken } from "../lib/authorize-token.js";

const userId = z.string().uuid();

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function logoutRoutes(users: UserStore, tokens: TokenStore): FastifyPluginAsync {
  return async (app) => {
    app.post("/logout", async (request, reply) => {
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
        const revoked = await tokens.revoke(session.jti);
        if (!revoked) {
          return reply.code(401).send({ error: "Invalid or expired token." });
        }
        return { revoked: true };
      } catch {
        return reply.code(401).send({ error: "Invalid or expired token." });
      }
    });

    app.post<{ Params: { id: string } }>("/users/:id/revoke-sessions", async (request, reply) => {
      const actor = headerValue(request.headers["x-user-id"]);
      if (headerValue(request.headers["x-user-role"]) !== "admin" || !userId.safeParse(actor).success) {
        return reply.code(403).send({ error: "Admin role is required." });
      }
      const target = userId.safeParse(request.params.id);
      if (!target.success) {
        return reply.code(400).send({ error: "Validation failed." });
      }

      const revoked = await tokens.revokeForUser(target.data);
      return { revoked };
    });
  };
}
