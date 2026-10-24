import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodType } from "zod";

import {
  blockIp,
  blockPath,
  getAccessControlSnapshot,
} from "../lib/access-control.js";
import { requireAdmin } from "../plugins/admin-auth.js";

const blockPathBody = z.object({ path: z.string().min(1) });
const blockIpBody = z.object({ ip: z.string().min(1) });

function parseBody<T>(
  schema: ZodType<T>,
  body: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): T | undefined {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    request.log.warn({ err: parsed.error, requestId: request.id }, "validation failed");
    reply.code(400).send({
      error: "Validation failed.",
      details: parsed.error.flatten(),
    });
    return undefined;
  }
  return parsed.data;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin/access-control", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return reply;
    }
    return getAccessControlSnapshot();
  });

  app.post("/admin/access-control/block-path", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return reply;
    }
    const body = parseBody(blockPathBody, request.body, request, reply);
    if (!body) {
      return reply;
    }
    blockPath(body.path);
    request.log.info(
      { action: "block_path", path: body.path, requestId: request.id },
      "admin blocked path",
    );
    return { ok: true, blocked_path: body.path };
  });

  app.post("/admin/access-control/block-ip", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return reply;
    }
    const body = parseBody(blockIpBody, request.body, request, reply);
    if (!body) {
      return reply;
    }
    blockIp(body.ip);
    request.log.info(
      { action: "block_ip", ip: body.ip, requestId: request.id },
      "admin blocked ip",
    );
    return { ok: true, blocked_ip: body.ip };
  });
};
