import type { AppUser } from "../db/users.js";
import type { TokenStore } from "../db/token-store.js";
import { signAccessToken } from "./token.js";

export async function issueSession(
  user: AppUser,
  tokens: TokenStore,
  options: { secret: string; issuer: string; ttlSeconds: number },
): Promise<{ token: string; expiresAt: string; user: { id: string; email: string; role: AppUser["role"] } }> {
  const signed = await signAccessToken(
    { id: user.id, email: user.email, role: user.role },
    options,
  );
  await tokens.save(signed.record);
  return {
    token: signed.token,
    expiresAt: signed.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}
