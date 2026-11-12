import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import { GATEWAY_CALLER, GATEWAY_CALLER_HEADER, GATEWAY_SECRET_HEADER } from "../lib/upstream-headers.js";
import {
  acceptBody,
  authRateLimit,
  deletionBody,
  forwardToJwtService,
  invitationBody,
  loginBody,
  registrationBody,
} from "./auth-forward.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.delete("/api/auth/account", authRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = deletionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter your current password and type DELETE to confirm." });
    const user = request.authUser;
    if (!user || !request.headers.authorization) return reply.code(401).send({ error: "Sign in before deleting your account." });
    const headers = {
      "content-type": "application/json",
      [GATEWAY_CALLER_HEADER]: GATEWAY_CALLER,
      [GATEWAY_SECRET_HEADER]: env.GATEWAY_INTERNAL_SECRET ?? "",
    };
    try {
      const verified = await fetch(new URL("/account/verify-password", env.JWT_SERVICE_URL), {
        method: "POST", headers: { ...headers, authorization: request.headers.authorization },
        body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(10000), redirect: "error",
      });
      const verification: unknown = await verified.json();
      if (!verified.ok) {
        const error = z.object({ error: z.string() }).safeParse(verification);
        return reply.code([400, 401, 403, 409, 429, 503].includes(verified.status) ? verified.status : 502)
          .send({ error: error.success ? error.data.error : "Could not confirm account deletion." });
      }
      if (!z.object({ verified: z.literal(true) }).safeParse(verification).success) throw new Error("Invalid password verification result.");
      const cleanup = await fetch(new URL("/api/account-data", env.HACKATHON_SERVICE_URL), {
        method: "DELETE", headers: {
          ...headers, "x-user-id": user.id, "x-user-email": user.email, "x-user-role": user.role,
        },
        signal: AbortSignal.timeout(15000), redirect: "error",
      });
      const result: unknown = await cleanup.json();
      if (!cleanup.ok || !z.object({ deleted: z.literal(true) }).safeParse(result).success) {
        throw new Error("Linked personal data cleanup failed; the account has not been deleted.");
      }
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, "Account data deletion failed.");
      return reply.code(502).send({ error: "Could not finish deleting linked data. Your account is still active; please retry." });
    }
    return forwardToJwtService(request, reply, "/account/delete", parsed.data, {
      authorization: request.headers.authorization,
    });
  });
  app.post("/api/auth/register", authRateLimit, async (request, reply) => {
    const parsed = registrationBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed.", details: parsed.error.flatten() });
    }
    return forwardToJwtService(request, reply, "/register", parsed.data);
  });
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
