import type { Role } from "../lib/roles.js";
import type { TokenStore } from "./token-store.js";

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

export type RegistrationStore = {
  createViewer(email: string, passwordHash: string): Promise<AppUser | null>;
};

export type AdminSetupStore = {
  setInitialAdminPassword(email: string, passwordHash: string): Promise<AppUser | null>;
};

export type AccountDeletionStore = {
  deleteAccount(id: string): Promise<boolean>;
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
