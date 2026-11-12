import type { IncomingHttpHeaders } from "node:http";
import proxy from "@fastify/http-proxy";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import { rewriteUpstreamHeaders } from "../lib/upstream-headers.js";
import { serviceTarget } from "../lib/service-target.js";

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
  if (env.PIPELINE_SERVICE_URL) {
    await app.register(proxy, {
      ...serviceTarget(env.PIPELINE_SERVICE_URL, "/pipeline"),
      prefix: "/api/hackscout/admin/pipeline",
      httpMethods: ["GET", "POST"],
      replyOptions,
    });
    await app.register(proxy, {
      ...serviceTarget(env.PIPELINE_SERVICE_URL),
      prefix: "/api/internal/pipeline-worker",
      httpMethods: ["GET", "POST"],
      replyOptions: { ...replyOptions, timeout: 125000 },
    });
  }
  await app.register(proxy, {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix: "/api/internal/hackathons/reset",
    rewritePrefix: "/api/internal/pipeline/reset",
    httpMethods: ["POST"],
    replyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix: "/api/hackscout/hackathons",
    rewritePrefix: "/api/hackathons",
    httpMethods: ["GET", "HEAD"],
    replyOptions: publicListingsReplyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix: "/api/hackscout/suggestions",
    rewritePrefix: "/api/suggestions",
    httpMethods: ["POST"],
    replyOptions: publicListingsReplyOptions,
  });
  await app.register(proxy, {
    upstream: env.HACKATHON_SERVICE_URL,
    prefix: "/api/hackscout/admin/suggestions",
    rewritePrefix: "/api/admin/suggestions",
    httpMethods: ["GET", "HEAD", "POST"],
    replyOptions,
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
    ...serviceTarget(env.SCRAPER_SERVICE_URL ?? "http://127.0.0.1:3000"),
    prefix: "/api/internal/scraper",
    httpMethods: ["GET", "POST"],
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
  await app.register(proxy, {
    ...serviceTarget(env.ETL_SERVICE_URL),
    prefix: "/api/etl",
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
  await app.register(proxy, {
    ...serviceTarget(env.ETL_SERVICE_URL),
    prefix: "/api/internal/etl",
    httpMethods: ["POST"],
    replyOptions: { ...replyOptions, timeout: 24 * 60 * 60 * 1000 },
  });
};
