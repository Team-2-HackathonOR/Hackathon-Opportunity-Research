import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authUser?.role === "admin") {
    return true;
  }

  if (request.authUser) {
    reply.code(403).send({ error: "Admin role is required." });
    return false;
  }

  if (!env.ADMIN_API_KEY) {
    reply.code(503).send({ error: "Admin API is disabled. Set ADMIN_API_KEY to enable." });
    return false;
  }

  const key = request.headers["x-admin-key"];
  if (key !== env.ADMIN_API_KEY) {
    reply.code(401).send({ error: "Invalid admin key." });
    return false;
  }

  return true;
}
