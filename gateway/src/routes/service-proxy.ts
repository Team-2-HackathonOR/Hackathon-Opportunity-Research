import type { IncomingHttpHeaders } from "node:http";

import proxy from "@fastify/http-proxy";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import { rewriteUpstreamHeaders } from "../lib/upstream-headers.js";

function hackathonProxy(prefix: string) {
  return {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix,
    rewritePrefix: prefix,
    replyOptions: {
      rewriteRequestHeaders: (request: object, headers: IncomingHttpHeaders) =>
        rewriteUpstreamHeaders(request, headers, env.GATEWAY_INTERNAL_SECRET),
    },
  };
}

export const serviceProxyRoutes: FastifyPluginAsync = async (app) => {
  await app.register(proxy, hackathonProxy("/api/hackathons"));
  await app.register(proxy, hackathonProxy("/api/organizer-followups"));
  await app.register(proxy, hackathonProxy("/api/exports"));

  if (env.AI_SERVICE_URL) {
    await app.register(proxy, {
      ...hackathonProxy("/api/ai"),
      upstream: env.AI_SERVICE_URL,
    });
    app.log.info({ upstream: env.AI_SERVICE_URL }, "AI service route enabled");
  } else {
    app.all("/api/ai/*", async (_request, reply) => {
      reply.code(503).send({
        error: "AI service is not configured.",
        env: "AI_SERVICE_URL",
      });
    });
  }

  if (env.SCRAPER_SERVICE_URL) {
    await app.register(proxy, {
      ...hackathonProxy("/api/scraper"),
      upstream: env.SCRAPER_SERVICE_URL,
    });
    app.log.info({ upstream: env.SCRAPER_SERVICE_URL }, "Scraper service route enabled");
  } else {
    app.all("/api/scraper/*", async (_request, reply) => {
      reply.code(503).send({
        error: "Scraper service is not configured.",
        env: "SCRAPER_SERVICE_URL",
      });
    });
  }
};
