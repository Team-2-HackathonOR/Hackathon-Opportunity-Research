import type { JwtEnv } from "../config/env.js";
import { hashPassword } from "./password.js";
import type { Role } from "./roles.js";
import type { UserDirectory } from "../db/users.js";

export type SeedAccount = {
  email: string;
  password: string;
  role: Role;
};

export function seedAccountsFromEnv(source: JwtEnv): SeedAccount[] {
  const rows: Array<{ email?: string; password?: string; role: Role }> = [
    { email: source.SEED_VIEWER_EMAIL, password: source.SEED_VIEWER_PASSWORD, role: "viewer" },
    { email: source.SEED_RESEARCHER_EMAIL, password: source.SEED_RESEARCHER_PASSWORD, role: "researcher" },
    { email: source.SEED_ADMIN_EMAIL, password: source.SEED_ADMIN_PASSWORD, role: "admin" },
  ];

  return rows.flatMap((row) => {
    const email = row.email?.trim().toLowerCase() ?? "";
    const password = row.password ?? "";
    if (!email || !password) {
      return [];
    }
    return [{ email, password, role: row.role }];
  });
}

export async function applySeedUsers(directory: UserDirectory, source: JwtEnv): Promise<number> {
  const accounts = seedAccountsFromEnv(source);
  for (const account of accounts) {
    const passwordHash = await hashPassword(account.password, source.BCRYPT_ROUNDS);
    await directory.upsert({
      email: account.email,
      passwordHash,
      role: account.role,
    });
  }
  return accounts.length;
}
