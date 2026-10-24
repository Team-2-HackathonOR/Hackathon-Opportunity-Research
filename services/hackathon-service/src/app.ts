import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import { authorizeServiceRequest } from "./lib/gateway-auth.js";
import { buildFastifyLogger, logCompletedRequest } from "./lib/logger.js";
import { eventDetailRoutes } from "./routes/event-details.js";
import { exportRoutes } from "./routes/exports.js";
import { hackathonRoutes } from "./routes/hackathons.js";
import { healthRoutes } from "./routes/health.js";
import { organizerFollowupRoutes } from "./routes/organizer-followups.js";

export async function buildApp(): Promise<FastifyInstance> {
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

  app.addHook("onRequest", async (request, reply) => {
    const denied = authorizeServiceRequest(request.url, request.headers, env.GATEWAY_INTERNAL_SECRET);
    if (denied) {
      return reply.code(denied.status).send(denied.body);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    logCompletedRequest(request, reply, env.SERVICE_NAME, "hackathon-service request completed");
  });

  await app.register(cors, { origin: true });
  await app.register(healthRoutes);
  await app.register(eventDetailRoutes);
  await app.register(hackathonRoutes);
  await app.register(organizerFollowupRoutes);
  await app.register(exportRoutes);

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
