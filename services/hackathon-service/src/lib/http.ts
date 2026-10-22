import type { FastifyReply, FastifyRequest } from "fastify";

import { mapDatabaseError } from "./pg-errors.js";

export function rejectRule(request: FastifyRequest, reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : "Invalid research record.";
  request.log.warn({ requestId: request.id, reason: message }, "record rejected by research rules");
  return reply.code(400).send({ error: message });
}

export function replyForDatabaseError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  fallback: string,
) {
  const mapped = mapDatabaseError(error);
  if (mapped) {
    request.log.warn({ err: error, requestId: request.id }, mapped.error);
    return reply.code(mapped.statusCode).send({ error: mapped.error });
  }

  request.log.error({ err: error, requestId: request.id }, fallback);
  return reply.code(500).send({ error: fallback });
}
