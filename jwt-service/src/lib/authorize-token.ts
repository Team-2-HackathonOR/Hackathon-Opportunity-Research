import type { TokenStore } from "../db/token-store.js";
import type { UserStore } from "../db/users.js";
import { verifyAccessToken, type VerifiedToken } from "./token.js";

export type AuthorizedSession = {
  id: string;
  email: string;
  role: VerifiedToken["role"];
  expiresAt: string;
  jti: string;
};

export async function authorizeAccessToken(
  token: string,
  options: { secret: string; issuer: string; tokens: TokenStore; users: UserStore; now?: number },
): Promise<AuthorizedSession> {
  const claims = await verifyAccessToken(token, options.secret, options.issuer);
  const record = await options.tokens.findById(claims.jti);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!record || record.revokedAt !== null || record.expiresAt <= now) {
    throw new Error("Token record was rejected.");
  }
  if (
    record.tokenSha !== claims.sha ||
    record.userId !== claims.id ||
    record.role !== claims.role ||
    record.issuer !== claims.issuer ||
    record.issuedAt !== claims.issuedAt ||
    record.expiresAt !== claims.expiresAtSeconds
  ) {
    throw new Error("Token record does not match the token.");
  }

  const account = await options.users.findById(claims.id);
  if (!account || account.email !== claims.email || account.role !== claims.role) {
    throw new Error("Token does not match the account.");
  }

  return {
    id: account.id,
    email: account.email,
    role: account.role,
    expiresAt: claims.expiresAt,
    jti: claims.jti,
  };
}
