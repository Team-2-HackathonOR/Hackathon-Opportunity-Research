export const ROLES = ["viewer", "researcher", "admin"] as const;

export type Role = (typeof ROLES)[number];

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.some((role) => role === value);
}

const READ_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

export function roleAllowsMethod(role: Role, method: string): boolean {
  if (role === "admin") {
    return true;
  }
  if (READ_METHODS.has(method)) {
    return role === "viewer" || role === "researcher";
  }
  if (WRITE_METHODS.has(method)) {
    return role === "researcher";
  }
  return false;
}

export function readVerifiedUser(value: unknown): AuthUser | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.email !== "string" ||
    typeof record.expiresAt !== "string" ||
    !isRole(record.role)
  ) {
    return undefined;
  }
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    expiresAt: record.expiresAt,
  };
}
