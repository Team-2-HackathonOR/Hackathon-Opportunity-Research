import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { evaluateAccess, resetRuntimeBlocklists } from "../lib/access-control.js";

const accessControlPluginImpl: FastifyPluginAsync = async (app) => {
  resetRuntimeBlocklists();

  app.addHook("onRequest", async (request, reply) => {
    const result = evaluateAccess(request);
    if (!result.allowed) {
      request.log.warn({ ip: request.ip, path: request.url, reason: result.reason }, "access denied");
      return reply.code(403).send({ error: result.reason ?? "Access denied." });
    }
  });
};

// fastify-plugin shares this hook with every route. A normal register()
// would keep the hook inside the plugin, so /health and /api would skip it.
export const accessControlPlugin = fp(accessControlPluginImpl, {
  name: "team-2-access-control",
});
