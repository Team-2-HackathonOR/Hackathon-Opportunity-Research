import type { AppUser, UserStore } from "../db/users.js";
import { verifyPassword } from "./password.js";

export async function authenticate(
  store: UserStore,
  email: string,
  password: string,
  dummyPasswordHash: string,
): Promise<AppUser | null> {
  const normalized = email.trim().toLowerCase();
  const user = await store.findByEmail(normalized);
  const canUsePassword =
    user !== null && (user.authSource ?? "local") === "local" && typeof user.passwordHash === "string";
  const passwordHash = canUsePassword ? user.passwordHash : dummyPasswordHash;
  const matches = await verifyPassword(password, passwordHash ?? dummyPasswordHash).catch(() => false);
  if (!canUsePassword || !user || !matches) {
    return null;
  }
  return user;
}
