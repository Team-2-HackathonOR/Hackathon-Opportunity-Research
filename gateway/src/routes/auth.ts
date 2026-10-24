import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import { ROLES } from "../lib/jwt.js";
import { GATEWAY_CALLER, GATEWAY_CALLER_HEADER, GATEWAY_SECRET_HEADER } from "../lib/upstream-headers.js";

const emailField = z
  .string()
  .trim()
  .min(3)
  .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), { message: "Invalid email." });

const loginBody = z.object({
  email: emailField,
  password: z.string().min(1),
});

const invitationBody = z.object({
  email: emailField,
  role: z.enum(ROLES),
});

const acceptBody = z.object({
  token: z.string().trim().min(32),
  password: z.string().min(8),
});

const authRateLimit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: 60_000,
    },
  },
} as const;

async function forwardToJwtService(
  request: FastifyRequest,
  reply: FastifyReply,
  pathname: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  if (!env.GATEWAY_INTERNAL_SECRET) {
    return reply.code(503).send({
      error: "Gateway secret is not configured.",
      env: "GATEWAY_INTERNAL_SECRET",
    });
  }

  const target = new URL(pathname, env.JWT_SERVICE_URL.endsWith("/") ? env.JWT_SERVICE_URL : `${env.JWT_SERVICE_URL}/`);
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [GATEWAY_CALLER_HEADER]: GATEWAY_CALLER,
        [GATEWAY_SECRET_HEADER]: env.GATEWAY_INTERNAL_SECRET,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    request.log.error({ err: message, requestId: request.id }, "jwt service unreachable");
    return reply.code(502).send({ error: "Gateway failed to reach the JWT service." });
  }

  const text = await response.text();
  try {
    const payload = text ? JSON.parse(text) : { error: "JWT service returned an empty response." };
    return reply.code(response.status).send(payload);
  } catch {
    return reply.code(502).send({ error: "JWT service returned an invalid response." });
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/auth/login", authRateLimit, async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed.",
        details: parsed.error.flatten(),
      });
    }

    return forwardToJwtService(request, reply, "/login", parsed.data);
  });

  app.post("/api/auth/invitations", authRateLimit, async (request, reply) => {
    if (request.authUser?.role !== "admin") {
      return reply.code(403).send({ error: "Admin role is required." });
    }

    const parsed = invitationBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed.",
        details: parsed.error.flatten(),
      });
    }

    return forwardToJwtService(request, reply, "/invitations", parsed.data, {
      "x-user-id": request.authUser.id,
      "x-user-role": request.authUser.role,
    });
  });

  app.post("/api/auth/invitations/accept", authRateLimit, async (request, reply) => {
    const parsed = acceptBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed.",
        details: parsed.error.flatten(),
      });
    }

    return forwardToJwtService(request, reply, "/invitations/accept", parsed.data);
  });

  app.post("/api/auth/logout", authRateLimit, async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing or invalid Authorization header." });
    }
    return forwardToJwtService(request, reply, "/logout", {}, { authorization });
  });

  app.post<{ Params: { id: string } }>("/api/auth/users/:id/revoke-sessions", authRateLimit, async (request, reply) => {
    if (request.authUser?.role !== "admin") {
      return reply.code(403).send({ error: "Admin role is required." });
    }
    const parsed = z.string().uuid().safeParse(request.params.id);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed." });
    }
    return forwardToJwtService(request, reply, `/users/${parsed.data}/revoke-sessions`, {}, {
      "x-user-id": request.authUser.id,
      "x-user-role": request.authUser.role,
    });
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "Missing or invalid Authorization header." });
    }

    return {
      id: request.authUser.id,
      email: request.authUser.email,
      role: request.authUser.role,
      expiresAt: request.authUser.expiresAt,
    };
  });
};
