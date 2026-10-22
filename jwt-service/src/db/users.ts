import pg from "pg";

import type { JwtEnv } from "../config/env.js";
import { authDatabaseUrl } from "../config/env.js";
import { isRole, type Role } from "../lib/roles.js";
import { createPgInvitationStore, type InvitationStore } from "./invitations.js";
import { createPgTokenStore, type TokenStore } from "./token-store.js";

export type AuthSource = "local" | "ldap";

export type AppUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  authSource: AuthSource;
  ldapDn: string | null;
};

export type UserStore = {
  findByEmail(email: string): Promise<AppUser | null>;
  findById(id: string): Promise<AppUser | null>;
};

export type DirectoryAccountInput = {
  email: string;
  role: Role;
  ldapDn: string;
};

export type DirectoryAccountResult = {
  user: AppUser;
  previousRole: Role | null;
};

export type UserDirectory = UserStore & {
  upsert(user: {
    email: string;
    passwordHash: string | null;
    role: Role;
    authSource?: AuthSource;
    ldapDn?: string | null;
  }): Promise<AppUser>;
  saveDirectoryAccount(input: DirectoryAccountInput): Promise<DirectoryAccountResult>;
  check(): Promise<boolean>;
  close(): Promise<void>;
  tokens: TokenStore;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  role: string;
  auth_source: string | null;
  ldap_dn: string | null;
};

const userColumns = "id, email, password_hash, role, auth_source, ldap_dn";

export function createPgUserDirectory(
  source: Pick<JwtEnv, "AUTH_DATABASE_URL" | "DATABASE_URL" | "DATABASE_SSL">,
): UserDirectory & InvitationStore {
  const pool = new pg.Pool({
    connectionString: authDatabaseUrl(source),
    max: 5,
    ssl: source.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
  const invitations = createPgInvitationStore(pool);
  const tokens = createPgTokenStore(pool);

  async function findByEmail(email: string): Promise<AppUser | null> {
    const result = await pool.query<UserRow>(
      `select ${userColumns} from app_auth.app_users where email = $1`,
      [email],
    );
    return mapUser(result.rows[0]);
  }

  async function upsert(user: {
    email: string;
    passwordHash: string | null;
    role: Role;
    authSource?: AuthSource;
    ldapDn?: string | null;
  }): Promise<AppUser> {
    const result = await pool.query<UserRow>(
      `insert into app_auth.app_users (email, password_hash, role, auth_source, ldap_dn)
       values ($1, $2, $3, $4, $5)
       on conflict (email) do update
       set password_hash = excluded.password_hash,
           role = excluded.role,
           auth_source = excluded.auth_source,
           ldap_dn = excluded.ldap_dn
       returning ${userColumns}`,
      [user.email, user.passwordHash, user.role, user.authSource ?? "local", user.ldapDn ?? null],
    );
    const saved = mapUser(result.rows[0]);
    if (!saved) {
      throw new Error("Account upsert returned an unusable row.");
    }
    return saved;
  }

  return {
    ...invitations,
    tokens,
    findByEmail,
    async findById(id: string) {
      const result = await pool.query<UserRow>(
        `select ${userColumns} from app_auth.app_users where id = $1`,
        [id],
      );
      return mapUser(result.rows[0]);
    },
    upsert,
    async saveDirectoryAccount(input) {
      const existing = await findByEmail(input.email);
      const user = await upsert({
        email: input.email,
        passwordHash: null,
        role: input.role,
        authSource: "ldap",
        ldapDn: input.ldapDn,
      });
      return { user, previousRole: existing?.role ?? null };
    },
    async check() {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export function mapUser(row: UserRow | undefined): AppUser | null {
  if (!row || !isRole(row.role)) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    authSource: row.auth_source === "ldap" ? "ldap" : "local",
    ldapDn: row.ldap_dn,
  };
}
