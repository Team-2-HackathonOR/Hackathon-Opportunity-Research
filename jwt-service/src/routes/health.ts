import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";

export function healthRoutes(checkDatabase?: () => Promise<boolean>): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async () => ({
      ok: true,
      service: env.SERVICE_NAME,
      timestamp: new Date().toISOString(),
    }));

    app.get("/health/live", async () => ({
      ok: true,
      check: "liveness",
      service: env.SERVICE_NAME,
    }));

    app.get("/health/ready", async (request, reply) => {
      if (!checkDatabase) {
        return {
          ok: true,
          check: "readiness",
          service: env.SERVICE_NAME,
          database: "not-configured",
        };
      }

      const databaseOk = await checkDatabase();
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
}
