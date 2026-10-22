import { type Writable } from "node:stream";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import { buildFastifyLogger, logCompletedRequest } from "./lib/logger.js";
import { accessControlPlugin } from "./plugins/access-control-plugin.js";
import { jwtAuthPlugin } from "./plugins/jwt-auth.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { gatewayInfoRoutes } from "./routes/gateway-info.js";
import { healthRoutes } from "./routes/health.js";
import { proxyRoutes } from "./routes/proxy.js";
import { serviceProxyRoutes } from "./routes/service-proxy.js";
import "./types/fastify.js";

export type BuildAppOptions = {
  logStream?: Writable;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildFastifyLogger({
      level: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      serviceName: env.SERVICE_NAME,
      logFilePath: env.LOG_FILE_PATH,
      stream: options.logStream,
    }),
    requestIdHeader: "x-request-id",
    genReqId: (request) =>
      (request.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
  });

  app.addHook("onRequest", async (request) => {
    request.headers["x-gateway-service"] = env.SERVICE_NAME;
  });

  app.addHook("onResponse", async (request, reply) => {
    logCompletedRequest(request, reply, env.SERVICE_NAME, "gateway request completed");
  });

  await app.register(cors, {
    origin: true,
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });
  await app.register(accessControlPlugin);
  await app.register(jwtAuthPlugin);
  await app.register(healthRoutes);
  await app.register(gatewayInfoRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(serviceProxyRoutes);
  await app.register(proxyRoutes);

  app.setErrorHandler((error, request, reply) => {
    const zodError =
      error instanceof ZodError
        ? error
        : error instanceof Error && error.cause instanceof ZodError
          ? error.cause
          : undefined;

    if (zodError) {
      request.log.warn({ err: zodError, requestId: request.id }, "validation failed");
      return reply.code(400).send({
        error: "Validation failed.",
        details: zodError.flatten(),
      });
    }

    request.log.error({ err: error, requestId: request.id }, "unhandled error");
    reply.code(500).send({ error: "Internal server error." });
  });

  return app;
}
