import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import type { TokenStore } from "../db/token-store.js";
import type { DirectoryAccountInput, DirectoryAccountResult, UserStore } from "../db/users.js";
import { authenticate } from "../lib/authenticate.js";
import type { DirectoryAuthenticator } from "../lib/directory.js";
import { mapDirectoryRole, type DirectoryGroupMapping } from "../lib/directory-role.js";
import { issueSession } from "../lib/session.js";

const loginBody = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), { message: "Invalid email." }),
  password: z.string().min(1),
});

export function loginRoutes(
  store: UserStore,
  dummyPasswordHash: string,
  tokens: TokenStore,
  options: {
    directory?: DirectoryAuthenticator;
    saveDirectoryAccount?: (input: DirectoryAccountInput) => Promise<DirectoryAccountResult>;
    groupMapping?: DirectoryGroupMapping;
  } = {},
): FastifyPluginAsync {
  return async (app) => {
    app.post("/login", async (request, reply) => {
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed.",
          details: parsed.error.flatten(),
        });
      }

      const email = parsed.data.email.toLowerCase();
      if (options.directory) {
        const directoryResult = await options.directory.authenticate(email, parsed.data.password);
        if (directoryResult.status === "unavailable") {
          return reply.code(503).send({ error: "Directory login is unavailable." });
        }
        if (directoryResult.status === "invalid") {
          return reply.code(401).send({ error: "Invalid email or password." });
        }
        if (directoryResult.status === "authenticated") {
          if (!options.saveDirectoryAccount) {
            return reply.code(503).send({ error: "Directory accounts are not configured." });
          }
          const role = mapDirectoryRole(directoryResult.identity.groups, options.groupMapping ?? {});
          if (!role) {
            return reply.code(403).send({ error: "This directory account is not allowed in this application." });
          }
          const saved = await options.saveDirectoryAccount({
            email,
            role,
            ldapDn: directoryResult.identity.dn,
          });
          if (saved.previousRole && saved.previousRole !== saved.user.role) {
            await tokens.revokeForUser(saved.user.id);
          }
          return issueSession(saved.user, tokens, {
            secret: env.JWT_SECRET,
            issuer: env.JWT_ISSUER,
            ttlSeconds: env.JWT_TTL_SECONDS,
          });
        }
      }

      const user = await authenticate(store, email, parsed.data.password, dummyPasswordHash);
      if (!user) {
        return reply.code(401).send({ error: "Invalid email or password." });
      }

      return issueSession(user, tokens, {
        secret: env.JWT_SECRET,
        issuer: env.JWT_ISSUER,
        ttlSeconds: env.JWT_TTL_SECONDS,
      });
    });
  };
}
