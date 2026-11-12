import type { IncomingHttpHeaders } from "node:http";
import proxy from "@fastify/http-proxy";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import { rewriteUpstreamHeaders } from "../lib/upstream-headers.js";

export const hackscoutRoutes: FastifyPluginAsync = async (app) => {
  const replyOptions = {
    rewriteRequestHeaders: (request: object, headers: IncomingHttpHeaders) =>
      rewriteUpstreamHeaders(request, headers, env.GATEWAY_INTERNAL_SECRET),
  };
  const publicListingsReplyOptions = {
    rewriteRequestHeaders: (request: object, headers: IncomingHttpHeaders) => {
      const rewritten = rewriteUpstreamHeaders(request, headers, env.GATEWAY_INTERNAL_SECRET);
      rewritten["x-user-id"] = rewritten["x-user-id"] ?? "hackscout-guest";
      rewritten["x-user-role"] = rewritten["x-user-role"] ?? "viewer";
      rewritten["x-user-email"] = rewritten["x-user-email"] ?? "guest@hackscout.local";
      return rewritten;
    },
  };
  await app.register(proxy, {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix: "/api/hackscout/hackathons",
    rewritePrefix: "/api/hackathons",
    httpMethods: ["GET", "HEAD"],
    replyOptions: publicListingsReplyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKSCOUT_SERVICE_URL,
    prefix: "/api/hackscout/admin/login",
    rewritePrefix: "/api/admin/login",
    httpMethods: ["POST"],
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    replyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKSCOUT_SERVICE_URL,
    prefix: "/api/hackscout",
    rewritePrefix: "/api",
    replyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKSCOUT_SERVICE_URL,
    prefix: "/hackscout-admin",
    rewritePrefix: "/admin",
    httpMethods: ["GET", "HEAD"],
  });
  await app.register(proxy, {
    upstream: env.SCRAPER_SERVICE_URL ?? "http://127.0.0.1:3000",
    prefix: "/api/internal/scraper",
    rewritePrefix: "",
    httpMethods: ["GET"],
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
  await app.register(proxy, {
    upstream: env.ETL_SERVICE_URL,
    prefix: "/api/etl",
    rewritePrefix: "",
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
  await app.register(proxy, {
    upstream: env.ETL_SERVICE_URL,
    prefix: "/api/internal/etl",
    rewritePrefix: "",
    httpMethods: ["POST"],
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
};
