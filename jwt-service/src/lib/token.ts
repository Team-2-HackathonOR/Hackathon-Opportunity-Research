import { createHash, randomUUID } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import type { IssuedTokenRecord } from "../db/token-store.js";
import { isRole, type Role } from "./roles.js";

const encoder = new TextEncoder();

export type TokenSubject = {
  id: string;
  email: string;
  role: Role;
};

export type SignedAccessToken = {
  token: string;
  expiresAt: string;
  record: IssuedTokenRecord;
};

export function createTokenSha(input: {
  issuer: string;
  userId: string;
  email: string;
  role: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  const hashSource = JSON.stringify({
    iss: input.issuer,
    sub: input.userId,
    userId: input.userId,
    email: input.email,
    role: input.role,
    jti: input.tokenId,
    iat: input.issuedAt,
    exp: input.expiresAt,
  });
  return createHash("sha256").update(hashSource).digest("hex");
}

export async function signAccessToken(
  user: TokenSubject,
  options: { secret: string; issuer: string; ttlSeconds: number; now?: number },
): Promise<SignedAccessToken> {
  const issuedAt = options.now ?? Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + options.ttlSeconds;
  const tokenId = randomUUID();
  const tokenSha = createTokenSha({
    issuer: options.issuer,
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenId,
    issuedAt,
    expiresAt: expiresAtSeconds,
  });
  const record: IssuedTokenRecord = {
    tokenId,
    tokenSha,
    userId: user.id,
    role: user.role,
    issuer: options.issuer,
    issuedAt,
    expiresAt: expiresAtSeconds,
    revokedAt: null,
  };
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    sha: tokenSha,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(tokenId)
    .setIssuer(options.issuer)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(encoder.encode(options.secret));

  return {
    token,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    record,
  };
}

export type VerifiedToken = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  jti: string;
  sha: string;
  issuer: string;
  issuedAt: number;
  expiresAtSeconds: number;
};

export async function verifyAccessToken(
  token: string,
  secret: string,
  issuer: string,
): Promise<VerifiedToken> {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    issuer,
    algorithms: ["HS256"],
  });
  const expiresAtSeconds = payload.exp;
  const issuedAt = payload.iat;
  if (
    !payload.sub ||
    payload.userId !== payload.sub ||
    typeof payload.email !== "string" ||
    !isRole(payload.role) ||
    typeof payload.jti !== "string" ||
    typeof payload.sha !== "string" ||
    payload.iss !== issuer
  ) {
    throw new Error("Token is missing required claims.");
  }
  if (typeof expiresAtSeconds !== "number" || typeof issuedAt !== "number") {
    throw new Error("Token is missing an expiry.");
  }

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    jti: payload.jti,
    sha: payload.sha,
    issuer: payload.iss,
    issuedAt,
    expiresAtSeconds,
  };
}
