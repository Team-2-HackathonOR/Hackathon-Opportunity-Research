import proxy from "@fastify/http-proxy";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  if (env.PROXY_GRAPHQL_UPSTREAM_URL) {
    await app.register(proxy, {
      upstream: env.PROXY_GRAPHQL_UPSTREAM_URL,
      prefix: "/proxy/graphql",
      rewritePrefix: "/",
    });
    app.log.info({ upstream: env.PROXY_GRAPHQL_UPSTREAM_URL }, "GraphQL proxy enabled");
  } else {
    app.all("/proxy/graphql", async (_request, reply) => {
      reply.code(503).send({
        error: "GraphQL proxy upstream is not configured.",
        env: "PROXY_GRAPHQL_UPSTREAM_URL",
      });
    });
  }
};
