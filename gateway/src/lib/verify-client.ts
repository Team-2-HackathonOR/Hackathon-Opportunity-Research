import { env } from "../config/env.js";
import { readVerifiedUser, type AuthUser } from "./jwt.js";
import { GATEWAY_CALLER, GATEWAY_CALLER_HEADER, GATEWAY_SECRET_HEADER } from "./upstream-headers.js";

export type BearerResult =
  | { status: "anonymous" }
  | { status: "unconfigured" }
  | { status: "invalid" }
  | { status: "unreachable" }
  | { status: "ok"; user: AuthUser };

export async function verifyBearer(
  authorization: string | undefined,
  logger?: Pick<FastifyBaseLogger, "error">,
): Promise<BearerResult> {
  if (!authorization) {
    return { status: "anonymous" };
  }
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    return { status: "invalid" };
  }
  if (!env.GATEWAY_INTERNAL_SECRET) {
    return { status: "unconfigured" };
  }

  const base = env.JWT_SERVICE_URL.endsWith("/") ? env.JWT_SERVICE_URL : `${env.JWT_SERVICE_URL}/`;
  const target = new URL("verify", base);
  const reportFailure = (reason: string, upstreamStatus?: number) => {
    logger?.error({
      upstreamOrigin: target.origin, upstreamPath: target.pathname, reason, upstreamStatus,
    }, "JWT session verification failed.");
  };
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: {
        authorization,
        [GATEWAY_CALLER_HEADER]: GATEWAY_CALLER,
        [GATEWAY_SECRET_HEADER]: env.GATEWAY_INTERNAL_SECRET,
      },
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });
  } catch {
    reportFailure("network_error_or_timeout");
    return { status: "unreachable" };
  }

  if (response.status === 401) {
    return { status: "invalid" };
  }
  if (!response.ok) {
    reportFailure("upstream_http_error", response.status);
    return { status: "unreachable" };
  }

  try {
    const user = readVerifiedUser(await response.json());
    if (!user) {
      reportFailure("invalid_session_payload", response.status);
      return { status: "unreachable" };
    }
    return { status: "ok", user };
  } catch {
    reportFailure("invalid_json_or_response_read_failure", response.status);
    return { status: "unreachable" };
  }
}
import type { FastifyBaseLogger } from "fastify";
