import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { adminSessionCookie } from "../lib/admin-session.js";
import { verifyBearer } from "../lib/verify-client.js";

const emailBody = z.object({ email: z.string().trim().max(254).email() }).strict();
const loginBody = emailBody.extend({ password: z.string().min(1).max(1024) }).strict();
const setupBody = emailBody.extend({
  password: z.string().min(8).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
}).strict();
const options = { config: { rateLimit: { max: 30, timeWindow: 60_000 } } };
const prefix = "/api/hackscout/admin/auth";

export const adminSessionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });

  async function authRequest(path: string, body: unknown, authorization?: string) {
    const response = await fetch(new URL(path, env.JWT_SERVICE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-caller": "team-2-gateway",
        "x-gateway-secret": env.GATEWAY_INTERNAL_SECRET ?? "",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: "error",
    });
    const payload: unknown = await response.json();
    return { response, payload };
  }
  const errorBody = z.object({ error: z.string() });
  const accessResult = z.object({ email: z.string().email(), passwordSetupRequired: z.boolean() });
  const sessionResult = z.object({ token: z.string().min(1) });
  for (const action of ["access", "login", "create-password"] as const) {
    app.post(`${prefix}/${action}`, options, async (request, reply) => {
      const parsed = (action === "access" ? emailBody : action === "login" ? loginBody : setupBody).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Enter a valid email and password (setup requires 8 characters, maximum 72 UTF-8 bytes)." });
      try {
        const { response, payload } = await authRequest(action === "login" ? "/login" : `/admin/${action}`, parsed.data);
        if (!response.ok) {
          const error = errorBody.safeParse(payload);
          return reply.code([400, 401, 403, 409, 429, 503].includes(response.status) ? response.status : 502)
            .send({ error: error.success ? error.data.error : "The authentication service could not complete this request." });
        }
        if (action === "access") {
          const result = accessResult.safeParse(payload);
          if (!result.success) throw new Error("Invalid administrator access response.");
          return result.data;
        }
        const session = sessionResult.safeParse(payload);
        if (!session.success) throw new Error("Invalid administrator session response.");
        const authorization = `Bearer ${session.data.token}`;
        const verified = await verifyBearer(authorization);
        if (verified.status !== "ok" || verified.user.role !== "admin") {
          await authRequest("/logout", {}, authorization);
          return reply.code(verified.status === "ok" ? 403 : 502).send({
            error: verified.status === "ok" ? "An administrator role is required." : "The administrator session could not be verified.",
          });
        }
        const age = Math.floor((Date.parse(verified.user.expiresAt) - Date.now()) / 1000);
        if (!Number.isFinite(age) || age <= 0) throw new Error("Invalid administrator session expiry.");
        reply.header("Set-Cookie", adminSessionCookie(session.data.token, age, env.NODE_ENV === "production"));
        return { user: verified.user };
      } catch (error) {
        request.log.error({ err: error, requestId: request.id }, "Administrator authentication failed.");
        return reply.code(502).send({ error: "The administrator authentication service is unavailable. Please try again." });
      }
    });
  }
  app.get(`${prefix}/session`, async (request) => ({ user: request.authUser }));
  app.post(`${prefix}/logout`, async (request, reply) => {
    reply.header("Set-Cookie", adminSessionCookie("", 0, env.NODE_ENV === "production"));
    try {
      const { response } = await authRequest("/logout", {}, request.headers.authorization);
      if (!response.ok) throw new Error(`Session revocation failed with HTTP ${response.status}.`);
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, "Administrator logout failed.");
      return reply.code(502).send({ error: "Signed out of this browser, but server session revocation failed." });
    }
  });
};
