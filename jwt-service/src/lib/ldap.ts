import { Client } from "ldapts";

import type { DirectoryAuthenticator } from "./directory.js";

export type LdapSettings = {
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
};

export function createLdapAuthenticator(settings: LdapSettings): DirectoryAuthenticator {
  return {
    async authenticate(email, password) {
      const service = new Client({ url: settings.url, timeout: 5000, connectTimeout: 5000 });
      try {
        await service.bind(settings.bindDn, settings.bindPassword);
        const filter = settings.userFilter.replaceAll("{{email}}", escapeFilter(email));
        const { searchEntries } = await service.search(settings.baseDn, {
          scope: "sub",
          filter,
          sizeLimit: 2,
          attributes: ["mail", "memberOf"],
        });
        if (searchEntries.length === 0) {
          return { status: "not-found" };
        }
        if (searchEntries.length > 1) {
          return { status: "invalid" };
        }

        const entry = searchEntries[0];
        const dn = typeof entry?.dn === "string" ? entry.dn : "";
        if (!dn) {
          return { status: "invalid" };
        }
        const groups = readGroups(entry?.memberOf);
        await service.unbind();

        const userClient = new Client({ url: settings.url, timeout: 5000, connectTimeout: 5000 });
        try {
          await userClient.bind(dn, password);
          return { status: "authenticated", identity: { email, dn, groups } };
        } catch (error) {
          if (isInvalidCredentials(error)) {
            return { status: "invalid" };
          }
          return { status: "unavailable" };
        } finally {
          await userClient.unbind().catch(() => undefined);
        }
      } catch (error) {
        if (isInvalidCredentials(error)) {
          return { status: "unavailable" };
        }
        return { status: "unavailable" };
      } finally {
        await service.unbind().catch(() => undefined);
      }
    },
  };
}

export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function readGroups(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function isInvalidCredentials(error: unknown): boolean {
  return error instanceof Error && error.name === "InvalidCredentialsError";
}
