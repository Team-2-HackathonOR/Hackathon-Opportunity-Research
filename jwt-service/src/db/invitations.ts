import { createHash, randomBytes } from "node:crypto";

import type pg from "pg";

import { isRole, type Role } from "../lib/roles.js";
import { mapUser, type AppUser } from "./users.js";

export type CreatedInvitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
};

export type CreateInvitationResult =
  | { status: "exists" }
  | { status: "created"; invitation: CreatedInvitation };

export type AcceptInvitationResult =
  | { status: "invalid" }
  | { status: "exists" }
  | { status: "ok"; user: AppUser };

export type InvitationStore = {
  createInvitation(input: {
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string;
  }): Promise<CreateInvitationResult>;
  acceptInvitation(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<AcceptInvitationResult>;
};

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  expires_at: Date | string;
  used_at: Date | string | null;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  role: string;
  auth_source: string | null;
  ldap_dn: string | null;
};

const lockEmail = "select pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)";

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildInviteUrl(base: string, token: string): string {
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}token=${encodeURIComponent(token)}`;
}

export function createPgInvitationStore(pool: pg.Pool): InvitationStore {
  return {
    async createInvitation(input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(lockEmail, [input.email]);
        const existing = await client.query("select id from app_auth.app_users where email = $1", [
          input.email,
        ]);
        if ((existing.rowCount ?? 0) > 0) {
          await client.query("rollback");
          return { status: "exists" };
        }

        await client.query(
          `update app_auth.invitations
           set used_at = now()
           where email = $1 and used_at is null`,
          [input.email],
        );
        const inserted = await client.query<InvitationRow>(
          `insert into app_auth.invitations (email, role, token_hash, expires_at, invited_by)
           values ($1, $2, $3, $4, $5)
           returning id, email, role, expires_at, used_at`,
          [input.email, input.role, input.tokenHash, input.expiresAt, input.invitedBy],
        );
        await client.query("commit");
        const invitation = mapInvitation(inserted.rows[0]);
        if (!invitation) {
          throw new Error("Invitation insert returned an unusable row.");
        }
        return { status: "created", invitation };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async acceptInvitation(input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const found = await client.query<InvitationRow>(
          `select id, email, role, expires_at, used_at
           from app_auth.invitations
           where token_hash = $1`,
          [input.tokenHash],
        );
        const preview = found.rows[0];
        if (!preview) {
          await client.query("rollback");
          return { status: "invalid" };
        }

        await client.query(lockEmail, [preview.email]);
        const locked = await client.query<InvitationRow>(
          `select id, email, role, expires_at, used_at
           from app_auth.invitations
           where id = $1
           for update`,
          [preview.id],
        );
        const current = locked.rows[0];
        if (!current || current.used_at || new Date(current.expires_at).getTime() <= input.now.getTime()) {
          await client.query("rollback");
          return { status: "invalid" };
        }

        const existing = await client.query("select id from app_auth.app_users where email = $1", [
          current.email,
        ]);
        if ((existing.rowCount ?? 0) > 0) {
          await client.query("rollback");
          return { status: "exists" };
        }

        if (!isRole(current.role)) {
          await client.query("rollback");
          return { status: "invalid" };
        }

        const inserted = await client.query<UserRow>(
          `insert into app_auth.app_users (email, password_hash, role, auth_source)
           values ($1, $2, $3, 'local')
           returning id, email, password_hash, role, auth_source, ldap_dn`,
          [current.email, input.passwordHash, current.role],
        );
        await client.query("update app_auth.invitations set used_at = $2 where id = $1", [
          current.id,
          input.now,
        ]);
        await client.query("commit");
        const user = mapUser(inserted.rows[0]);
        if (!user) {
          throw new Error("Accepted invitation did not return a user.");
        }
        return { status: "ok", user };
      } catch (error) {
        await rollback(client);
        if (isUniqueViolation(error)) {
          return { status: "exists" };
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function mapInvitation(row: InvitationRow | undefined): CreatedInvitation | null {
  if (!row || !isRole(row.role)) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

async function rollback(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // The connection may already be aborted.
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
