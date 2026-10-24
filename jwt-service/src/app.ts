import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import type { InvitationStore } from "./db/invitations.js";
import { createMemoryTokenStore, type TokenStore } from "./db/token-store.js";
import type { DirectoryAccountInput, DirectoryAccountResult, UserStore } from "./db/users.js";
import { authorizeGatewayCaller } from "./lib/gateway-auth.js";
import type { DirectoryAuthenticator } from "./lib/directory.js";
import type { DirectoryGroupMapping } from "./lib/directory-role.js";
import { buildFastifyLogger, logCompletedRequest } from "./lib/logger.js";
import { sendInviteMail, type MailResult } from "./lib/mail.js";
import { hashPassword } from "./lib/password.js";
import { healthRoutes } from "./routes/health.js";
import { invitationRoutes } from "./routes/invitations.js";
import { loginRoutes } from "./routes/login.js";
import { logoutRoutes } from "./routes/logout.js";
import { verifyRoutes } from "./routes/verify.js";

export type BuildAppOptions = {
  userStore: UserStore;
  invitationStore?: InvitationStore;
  tokenStore?: TokenStore;
  checkDatabase?: () => Promise<boolean>;
  dummyPasswordHash?: string;
  bcryptRounds?: number;
  directory?: DirectoryAuthenticator;
  saveDirectoryAccount?: (input: DirectoryAccountInput) => Promise<DirectoryAccountResult>;
  groupMapping?: DirectoryGroupMapping;
  sendMail?: (input: { to: string; inviteUrl: string }) => Promise<MailResult>;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildFastifyLogger({
      level: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      serviceName: env.SERVICE_NAME,
      logFilePath: env.LOG_FILE_PATH,
    }),
    requestIdHeader: "x-request-id",
    genReqId: (request) =>
      (request.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
  });

  const dummyPasswordHash =
    options.dummyPasswordHash ?? (await hashPassword("jwt-service-dummy-password", env.BCRYPT_ROUNDS));
  const tokenStore =
    options.tokenStore ?? (env.NODE_ENV === "test" ? createMemoryTokenStore() : undefined);
  if (!tokenStore) {
    throw new Error("Token store is required.");
  }
  const sendMail =
    options.sendMail ??
    ((input: { to: string; inviteUrl: string }) =>
      sendInviteMail({
        to: input.to,
        inviteUrl: input.inviteUrl,
        mailServiceUrl: env.MAIL_SERVICE_URL,
        gatewaySecret: env.GATEWAY_INTERNAL_SECRET,
      }));

  app.addHook("onRequest", async (request, reply) => {
    const denied = authorizeGatewayCaller(
      request.url,
      request.headers,
      env.GATEWAY_INTERNAL_SECRET,
      env.SERVICE_NAME,
    );
    if (denied) {
      return reply.code(denied.status).send(denied.body);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    logCompletedRequest(request, reply, env.SERVICE_NAME, "jwt-service request completed");
  });

  await app.register(cors, { origin: true });
  await app.register(healthRoutes(options.checkDatabase));
  await app.register(
    loginRoutes(options.userStore, dummyPasswordHash, tokenStore, {
      directory: options.directory,
      saveDirectoryAccount: options.saveDirectoryAccount,
      groupMapping: options.groupMapping ?? {
        admin: env.LDAP_GROUP_ADMIN,
        researcher: env.LDAP_GROUP_RESEARCHER,
        viewer: env.LDAP_GROUP_VIEWER,
      },
    }),
  );
  await app.register(verifyRoutes(options.userStore, tokenStore));
  await app.register(logoutRoutes(options.userStore, tokenStore));
  await app.register(
    invitationRoutes(options.invitationStore, tokenStore, options.bcryptRounds ?? env.BCRYPT_ROUNDS, sendMail),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ err: error, requestId: request.id }, "validation failed");
      return reply.code(400).send({
        error: "Validation failed.",
        details: error.flatten(),
      });
    }

    request.log.error({ err: error, requestId: request.id }, "unhandled error");
    reply.code(500).send({ error: "Internal server error." });
  });

  return app;
}
