import { SignJWT } from "jose";

import type { Role } from "../src/lib/jwt.js";
import { TEST_JWT_ISSUER, TEST_JWT_SECRET } from "./constants.js";

export async function signTestToken(
  role: Role,
  overrides: { expiresInSeconds?: number; secret?: string; issuer?: string; email?: string } = {},
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const ttl = overrides.expiresInSeconds ?? 7200;
  return new SignJWT({ email: overrides.email ?? `${role}@local`, role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-1111-1111-111111111111")
    .setIssuer(overrides.issuer ?? TEST_JWT_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttl)
    .sign(new TextEncoder().encode(overrides.secret ?? TEST_JWT_SECRET));
}
