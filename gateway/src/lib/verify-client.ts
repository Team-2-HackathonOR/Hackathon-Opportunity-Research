import { env } from "../config/env.js";
import { readVerifiedUser, type AuthUser } from "./jwt.js";
import { GATEWAY_CALLER, GATEWAY_CALLER_HEADER, GATEWAY_SECRET_HEADER } from "./upstream-headers.js";

export type BearerResult =
  | { status: "anonymous" }
  | { status: "unconfigured" }
  | { status: "invalid" }
  | { status: "unreachable" }
  | { status: "ok"; user: AuthUser };

export async function verifyBearer(authorization: string | undefined): Promise<BearerResult> {
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
  let response: Response;
  try {
    response = await fetch(new URL("verify", base), {
      method: "POST",
      headers: {
        authorization,
        [GATEWAY_CALLER_HEADER]: GATEWAY_CALLER,
        [GATEWAY_SECRET_HEADER]: env.GATEWAY_INTERNAL_SECRET,
      },
    });
  } catch {
    return { status: "unreachable" };
  }

  if (response.status === 401) {
    return { status: "invalid" };
  }
  if (!response.ok) {
    return { status: "unreachable" };
  }

  try {
    const user = readVerifiedUser(await response.json());
    if (!user) {
      return { status: "unreachable" };
    }
    return { status: "ok", user };
  } catch {
    return { status: "unreachable" };
  }
}
