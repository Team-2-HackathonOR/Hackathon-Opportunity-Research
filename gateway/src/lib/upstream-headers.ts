import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import type { FastifyRequest } from "fastify";

import type { AuthUser } from "./jwt.js";

export const GATEWAY_CALLER = "team-2-gateway";
export const GATEWAY_CALLER_HEADER = "x-gateway-caller";
export const GATEWAY_SECRET_HEADER = "x-gateway-secret";

const IDENTITY_HEADERS = [
  "x-user-id",
  "x-user-role",
  "x-user-email",
  GATEWAY_CALLER_HEADER,
  GATEWAY_SECRET_HEADER,
] as const;

type RequestWithUser = {
  authUser?: AuthUser;
  raw?: IncomingMessage & { authUser?: AuthUser };
};

export function attachAuthUser(request: FastifyRequest, user: AuthUser): void {
  request.authUser = user;
  const raw = request.raw as IncomingMessage & { authUser?: AuthUser };
  raw.authUser = user;
}

export function readAttachedUser(request: RequestWithUser | IncomingMessage): AuthUser | undefined {
  if ("authUser" in request && request.authUser) {
    return request.authUser;
  }
  if ("raw" in request && request.raw?.authUser) {
    return request.raw.authUser;
  }
  return undefined;
}

export function rewriteUpstreamHeaders(
  request: object,
  headers: IncomingHttpHeaders,
  secret: string | undefined,
): IncomingHttpHeaders {
  const next: IncomingHttpHeaders = { ...headers };
  for (const name of IDENTITY_HEADERS) {
    delete next[name];
  }

  const user = readAttachedUser(request as RequestWithUser);
  if (user) {
    next["x-user-id"] = user.id;
    next["x-user-role"] = user.role;
    next["x-user-email"] = user.email;
  }

  next[GATEWAY_CALLER_HEADER] = GATEWAY_CALLER;
  if (secret) {
    next[GATEWAY_SECRET_HEADER] = secret;
  }
  return next;
}
