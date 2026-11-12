import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { AccountDeletionStore, UserStore } from "../db/users.js";
import { authorizeAccessToken } from "../lib/authorize-token.js";
import type { DirectoryAuthenticator } from "../lib/directory.js";
import { verifyPassword } from "../lib/password.js";
import { seedAccountsFromEnv } from "../lib/seed.js";

const deletionBody = z.object({
  password: z.string().min(1).max(1024), confirmation: z.literal("DELETE"),
}).strict();

export function accountDeletionRoutes(
  users: UserStore, deletion: AccountDeletionStore | undefined, tokens: TokenStore,
  directory: DirectoryAuthenticator | undefined,
): FastifyPluginAsync {
  return async (app) => {
    for (const action of ["verify-password", "delete"]) {
      app.post(`/account/${action}`, async (request, reply) => {
        const parsed = deletionBody.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Enter your current password and type DELETE to confirm." });
        const authorization = request.headers.authorization;
        if (!authorization?.startsWith("Bearer ")) return reply.code(401).send({ error: "Sign in before deleting your account." });
        let session;
        try {
          session = await authorizeAccessToken(authorization.slice(7), {
            secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, tokens, users,
          });
        } catch (error) {
          request.log.warn({ err: error, requestId: request.id }, "Account deletion session rejected.");
          return reply.code(401).send({ error: "The sign-in session is invalid or expired." });
        }
        const account = await users.findById(session.id);
        if (!account) return reply.code(401).send({ error: "The account no longer exists." });
        if (seedAccountsFromEnv(env).some((seed) => seed.email === account.email)) {
          return reply.code(409).send({ error: "This account is managed by server seed configuration. Ask the administrator to remove its seed email/password settings and restart the JWT service before deleting it." });
        }
        let passwordMatches = false;
        if (account.authSource === "ldap") {
          if (!directory) return reply.code(503).send({ error: "Directory authentication is unavailable." });
          const result = await directory.authenticate(account.email, parsed.data.password);
          if (result.status === "unavailable") return reply.code(503).send({ error: "Directory authentication is unavailable." });
          passwordMatches = result.status === "authenticated" && result.identity.email.trim().toLowerCase() === account.email;
        } else if (account.passwordHash) {
          passwordMatches = await verifyPassword(parsed.data.password, account.passwordHash);
        }
        if (!passwordMatches) return reply.code(403).send({ error: "The current password is incorrect." });
        if (!deletion) return reply.code(503).send({ error: "Account deletion is unavailable." });
        if (action === "verify-password") return { verified: true };
        if (!await deletion.deleteAccount(session.id)) return reply.code(409).send({ error: "The account was already removed." });
        return { deleted: true };
      });
    }
  };
}
