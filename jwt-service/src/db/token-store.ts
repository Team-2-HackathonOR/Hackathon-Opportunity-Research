import pg from "pg";

import type { Role } from "../lib/roles.js";

export type IssuedTokenRecord = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: Role;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type TokenStore = {
  save(record: IssuedTokenRecord): Promise<void>;
  findById(tokenId: string): Promise<IssuedTokenRecord | null>;
  revoke(tokenId: string, revokedAt?: number): Promise<IssuedTokenRecord | null>;
  revokeForUser(userId: string, revokedAt?: number): Promise<number>;
  deleteExpired(olderThan: number): Promise<number>;
};

type TokenRow = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: string;
  issuer: string;
  issuedAt: number | string;
  expiresAt: number | string;
  revokedAt: number | string | null;
};

const tokenColumns = `
  token_id as "tokenId",
  token_sha as "tokenSha",
  user_id as "userId",
  role,
  issuer,
  issued_at as "issuedAt",
  expires_at as "expiresAt",
  revoked_at as "revokedAt"
`;

export function createMemoryTokenStore(): TokenStore {
  const rows = new Map<string, IssuedTokenRecord>();

  return {
    async save(record) {
      rows.set(record.tokenId, { ...record });
    },
    async findById(tokenId) {
      const row = rows.get(tokenId);
      return row ? { ...row } : null;
    },
    async revoke(tokenId, revokedAt = unixNow()) {
      const row = rows.get(tokenId);
      if (!row || row.revokedAt !== null) {
        return null;
      }
      row.revokedAt = revokedAt;
      return { ...row };
    },
    async revokeForUser(userId, revokedAt = unixNow()) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.userId === userId && row.revokedAt === null) {
          row.revokedAt = revokedAt;
          count += 1;
        }
      }
      return count;
    },
    async deleteExpired(olderThan) {
      let count = 0;
      for (const [tokenId, row] of rows) {
        if (row.expiresAt < olderThan) {
          rows.delete(tokenId);
          count += 1;
        }
      }
      return count;
    },
  };
}

export function createPgTokenStore(pool: pg.Pool): TokenStore {
  return {
    async save(record) {
      await pool.query(
        `insert into app_auth.jwt_tokens (
           token_id, token_sha, user_id, role, issuer, issued_at, expires_at, revoked_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          record.tokenId,
          record.tokenSha,
          record.userId,
          record.role,
          record.issuer,
          record.issuedAt,
          record.expiresAt,
          record.revokedAt,
        ],
      );
    },
    async findById(tokenId) {
      const result = await pool.query<TokenRow>(
        `select ${tokenColumns} from app_auth.jwt_tokens where token_id = $1`,
        [tokenId],
      );
      return mapToken(result.rows[0]);
    },
    async revoke(tokenId, revokedAt = unixNow()) {
      const result = await pool.query<TokenRow>(
        `update app_auth.jwt_tokens
         set revoked_at = $2
         where token_id = $1 and revoked_at is null
         returning ${tokenColumns}`,
        [tokenId, revokedAt],
      );
      return mapToken(result.rows[0]);
    },
    async revokeForUser(userId, revokedAt = unixNow()) {
      const result = await pool.query(
        `update app_auth.jwt_tokens
         set revoked_at = $2
         where user_id = $1 and revoked_at is null`,
        [userId, revokedAt],
      );
      return result.rowCount ?? 0;
    },
    async deleteExpired(olderThan) {
      const result = await pool.query("delete from app_auth.jwt_tokens where expires_at < $1", [olderThan]);
      return result.rowCount ?? 0;
    },
  };
}

function mapToken(row: TokenRow | undefined): IssuedTokenRecord | null {
  if (!row || (row.role !== "viewer" && row.role !== "researcher" && row.role !== "admin")) {
    return null;
  }
  return {
    tokenId: row.tokenId,
    tokenSha: row.tokenSha,
    userId: row.userId,
    role: row.role,
    issuer: row.issuer,
    issuedAt: asNumber(row.issuedAt),
    expiresAt: asNumber(row.expiresAt),
    revokedAt: row.revokedAt === null ? null : asNumber(row.revokedAt),
  };
}

function asNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Token row contained a non-numeric timestamp.");
  }
  return parsed;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
