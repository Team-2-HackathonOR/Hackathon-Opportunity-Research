import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import { ROLES } from "../lib/jwt.js";
import { GATEWAY_CALLER, GATEWAY_CALLER_HEADER, GATEWAY_SECRET_HEADER } from "../lib/upstream-headers.js";

const emailField = z
  .string()
  .trim()
  .min(3)
  .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), { message: "Invalid email." });

export const loginBody = z.object({
  email: emailField,
  password: z.string().min(1),
});

export const registrationBody = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(8).refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be at most 72 UTF-8 bytes.",
  }),
}).strict();

export const invitationBody = z.object({
  email: emailField,
  role: z.enum(ROLES),
});

export const acceptBody = z.object({
  token: z.string().trim().min(32),
  password: z.string().min(8),
});

export const deletionBody = z.object({
  password: z.string().min(1).max(1024),
  confirmation: z.literal("DELETE"),
}).strict();

export const authRateLimit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: 60_000,
    },
  },
} as const;

export async function forwardToJwtService(
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
