import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import {
  buildInviteUrl,
  createInviteToken,
  hashInviteToken,
  type InvitationStore,
} from "../db/invitations.js";
import type { TokenStore } from "../db/token-store.js";
import type { MailResult } from "../lib/mail.js";
import { hashPassword } from "../lib/password.js";
import { ROLES } from "../lib/roles.js";
import { issueSession } from "../lib/session.js";

const emailField = z
  .string()
  .trim()
  .min(3)
  .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), { message: "Invalid email." });

const createBody = z.object({
  email: emailField,
  role: z.enum(ROLES),
});

const acceptBody = z.object({
  token: z.string().trim().min(32),
  password: z.string().min(8),
});

const adminId = z.string().uuid();

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function invitationRoutes(
  store: InvitationStore | undefined,
  tokens: TokenStore,
  bcryptRounds: number,
  sendMail: (input: { to: string; inviteUrl: string }) => Promise<MailResult>,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/invitations", async (request, reply) => {
      if (!store) {
        return reply.code(503).send({ error: "Invitation store is not configured." });
      }

      const invitedBy = headerValue(request.headers["x-user-id"]);
      if (headerValue(request.headers["x-user-role"]) !== "admin" || !adminId.safeParse(invitedBy).success) {
        return reply.code(403).send({ error: "Admin role is required." });
      }

      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed.",
          details: parsed.error.flatten(),
        });
      }

      const email = parsed.data.email.toLowerCase();
      const token = createInviteToken();
      const created = await store.createInvitation({
        email,
        role: parsed.data.role,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + env.INVITE_TTL_SECONDS * 1000),
        invitedBy,
      });
      if (created.status === "exists") {
        return reply.code(409).send({ error: "An account with this email already exists." });
      }

      const inviteUrl = buildInviteUrl(env.INVITE_URL_BASE, token);
      const mail = await sendMail({ to: email, inviteUrl });
      return reply.code(201).send({
        invitationId: created.invitation.id,
        email: created.invitation.email,
        role: created.invitation.role,
        expiresAt: created.invitation.expiresAt,
        inviteUrl,
        mail,
      });
    });

    app.post("/invitations/accept", async (request, reply) => {
      if (!store) {
        return reply.code(503).send({ error: "Invitation store is not configured." });
      }

      const parsed = acceptBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed.",
          details: parsed.error.flatten(),
        });
      }

      const accepted = await store.acceptInvitation({
        tokenHash: hashInviteToken(parsed.data.token),
        passwordHash: await hashPassword(parsed.data.password, bcryptRounds),
        now: new Date(),
      });
      if (accepted.status === "invalid") {
        return reply.code(400).send({ error: "Invitation is invalid or expired." });
      }
      if (accepted.status === "exists") {
        return reply.code(409).send({ error: "An account with this email already exists." });
      }

      return issueSession(accepted.user, tokens, {
        secret: env.JWT_SECRET,
        issuer: env.JWT_ISSUER,
        ttlSeconds: env.JWT_TTL_SECONDS,
      });
    });
  };
}
