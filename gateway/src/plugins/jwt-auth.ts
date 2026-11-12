import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";
import { roleAllowsMethod } from "../lib/jwt.js";
import { attachAuthUser } from "../lib/upstream-headers.js";
import { verifyBearer, type BearerResult } from "../lib/verify-client.js";
import { ADMIN_REQUEST_HEADER, adminCookieToken, adminSessionCookie } from "../lib/admin-session.js";

const PROXIED_PREFIXES = [
  "/api/hackathons",
  "/api/organizer-followups",
  "/api/exports",
  "/api/ai",
  "/api/scraper",
  "/api/hackscout",
  "/api/etl",
];

export function normalizePath(url: string): string {
  const path = url.split("?")[0] ?? url;
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

export function isPublicRoute(method: string, path: string): boolean {
  if (method === "GET" && (path === "/health" || path === "/health/live" || path === "/health/ready")) {
    return true;
  }
  if (method === "GET" && path === "/gateway/routes") {
    return true;
  }
  if ((method === "GET" || method === "HEAD") &&
      ["/api/hackscout/hackathons", "/api/hackscout/health"].includes(path)) return true;
  if (method === "POST" &&
      ["/api/hackscout/suggestions", "/api/hackscout/admin/login",
        "/api/hackscout/admin/auth/access", "/api/hackscout/admin/auth/login",
        "/api/hackscout/admin/auth/create-password"].includes(path)) return true;
  return method === "POST" && (
    path === "/api/auth/login" || path === "/api/auth/register" || path === "/api/auth/invitations/accept"
  );
}

function isProxiedApi(path: string): boolean {
  return PROXIED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function rejectBearer(result: BearerResult, reply: FastifyReply): boolean {
  if (result.status === "unconfigured") {
    reply.code(503).send({
      error: "Gateway secret is not configured.",
      env: "GATEWAY_INTERNAL_SECRET",
    });
    return true;
  }
  if (result.status === "unreachable") {
    reply.code(502).send({ error: "Gateway failed to reach the JWT service." });
    return true;
  }
  if (result.status === "anonymous") {
    reply.code(401).send({ error: "Missing or invalid Authorization header." });
    return true;
  }
  if (result.status === "invalid") {
    reply.code(401).send({ error: "Invalid or expired token." });
    return true;
  }
  return false;
}

const jwtAuthPluginImpl: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }

    const path = normalizePath(request.url);
    if (path.startsWith("/api/hackscout/admin/")) {
      reply.header("Cache-Control", "no-store");
      const cookieToken = adminCookieToken(request.headers.cookie);
      const cookieSession = !request.headers.authorization && cookieToken;
      const authAction = path.startsWith("/api/hackscout/admin/auth/");
      if (request.method !== "GET" && request.method !== "HEAD" &&
          (cookieSession || authAction) && request.headers[ADMIN_REQUEST_HEADER] !== "1") {
        return reply.code(403).send({ error: "A same-origin administrator request is required." });
      }
      if (cookieSession) request.headers.authorization = `Bearer ${cookieToken}`;
    }
    if (path === "/api/scraper/hackathons/reset") {
      return reply.code(403).send({ error: "Database resets require the internal pipeline route." });
    }
    if (path === "/api/hackscout" || path.startsWith("/api/hackscout/")) {
      if (!env.GATEWAY_INTERNAL_SECRET) {
        return reply.code(503).send({ error: "Gateway secret is not configured." });
      }
    }
    if (path.startsWith("/api/internal/")) {
      const supplied = request.headers["x-gateway-secret"];
      const expected = env.GATEWAY_INTERNAL_SECRET;
      const valid = typeof supplied === "string" && !!expected &&
        Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
      const allowed = request.method === "GET" && path === "/api/internal/scraper/hackathons/persist-all"
        || request.method === "POST" && [
          "/api/internal/scraper/hackathons/reset", "/api/internal/hackathons/reset",
        ].includes(path)
        || request.method === "POST" && path === "/api/internal/etl/etl/import/mongodb"
        || request.method === "GET" && [
          "/api/internal/pipeline-worker/pipeline", "/api/internal/pipeline-worker/schedule",
        ].includes(path)
        || request.method === "POST" && [
          "/api/internal/pipeline-worker/pipeline/run", "/api/internal/pipeline-worker/schedule",
          "/api/internal/pipeline-worker/pipeline/tick",
        ].includes(path);
      if (!valid || request.headers["x-gateway-caller"] !== "team-2-gateway" || !allowed) {
        request.log.warn({ path, requestId: request.id }, "internal pipeline access denied");
        return reply.code(403).send({ error: "Internal pipeline access is required." });
      }
      return;
    }
    if (isPublicRoute(request.method, path)) {
      return;
    }

    if (path === "/admin" || path.startsWith("/admin/")) {
      const result = await verifyBearer(request.headers.authorization, request.log);
      if (result.status === "anonymous") {
        return;
      }
      if (rejectBearer(result, reply) || result.status !== "ok") {
        return;
      }
      attachAuthUser(request, result.user);
      return;
    }

    if (!path.startsWith("/api/")) {
      return;
    }

    const result = await verifyBearer(request.headers.authorization, request.log);
    if (path.startsWith("/api/hackscout/admin/") && result.status === "invalid") {
      reply.header("Set-Cookie", adminSessionCookie("", 0, env.NODE_ENV === "production"));
    }
    if (rejectBearer(result, reply) || result.status !== "ok") {
      return;
    }
    if ((path === "/api/hackscout/admin" || path.startsWith("/api/hackscout/admin/") ||
        path === "/api/etl" || path.startsWith("/api/etl/")) &&
        result.user.role !== "admin") {
      return reply.code(403).send({ error: "An administrator role is required." });
    }
    if (path === "/api/auth/logout" || path === "/api/auth/account" && request.method === "DELETE") {
      attachAuthUser(request, result.user);
      return;
    }
    if (!roleAllowsMethod(result.user.role, request.method)) {
      return reply.code(403).send({ error: "This role cannot perform that action." });
    }

    attachAuthUser(request, result.user);

    if (isProxiedApi(path) && !env.GATEWAY_INTERNAL_SECRET) {
      return reply.code(503).send({
        error: "Gateway secret is not configured.",
        env: "GATEWAY_INTERNAL_SECRET",
      });
    }
  });
};

export const jwtAuthPlugin = fp(jwtAuthPluginImpl, {
  name: "team-2-jwt-auth",
});
