import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import { checkDatabaseConnection } from "../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    service: env.SERVICE_NAME,
    database_driver: "postgresql+drizzle",
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/live", async () => ({
    ok: true,
    check: "liveness",
    service: env.SERVICE_NAME,
  }));

  app.get("/health/ready", async (request, reply) => {
    const databaseOk = await checkDatabaseConnection();
    if (!databaseOk) {
      request.log.warn({ requestId: request.id }, "readiness check failed");
      return reply.code(503).send({
        ok: false,
        check: "readiness",
        service: env.SERVICE_NAME,
        database: "unavailable",
      });
    }

    return {
      ok: true,
      check: "readiness",
      service: env.SERVICE_NAME,
      database: "ok",
    };
  });
};
