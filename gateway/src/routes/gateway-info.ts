import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";

export const gatewayInfoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/gateway/routes", async () => ({
    service: env.SERVICE_NAME,
    role: "api-gateway",
    routes: [
      { path: "POST /api/auth/login", upstream: env.JWT_SERVICE_URL, access: "public" },
      { path: "POST /api/auth/invitations", upstream: env.JWT_SERVICE_URL, access: "admin" },
      { path: "POST /api/auth/invitations/accept", upstream: env.JWT_SERVICE_URL, access: "public" },
      { path: "POST /api/auth/logout", upstream: env.JWT_SERVICE_URL, access: "authenticated" },
      { path: "POST /api/auth/users/:id/revoke-sessions", upstream: env.JWT_SERVICE_URL, access: "admin" },
      { path: "GET /api/auth/me", upstream: "gateway", access: "authenticated" },
      { path: "/api/hackathons/*", upstream: env.HACKATHON_SERVICE_URL, access: "authenticated" },
      { path: "/api/organizer-followups/*", upstream: env.HACKATHON_SERVICE_URL, access: "authenticated" },
      { path: "/api/exports/*", upstream: env.HACKATHON_SERVICE_URL, access: "authenticated" },
      { path: "/api/ai/*", upstream: env.AI_SERVICE_URL ?? "not configured", access: "authenticated" },
      { path: "/api/scraper/*", upstream: env.SCRAPER_SERVICE_URL ?? "not configured", access: "authenticated" },
      { path: "/proxy/graphql", upstream: env.PROXY_GRAPHQL_UPSTREAM_URL ?? "not configured", access: "public" },
    ],
  }));
};
