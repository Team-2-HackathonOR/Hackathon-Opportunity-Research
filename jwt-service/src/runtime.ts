import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { createPgUserDirectory } from "./db/users.js";
import { createLdapAuthenticator } from "./lib/ldap.js";
import { applySeedUsers } from "./lib/seed.js";

export async function createRuntime() {
  const directory = createPgUserDirectory(env);
  try {
    const ldap =
      env.LDAP_URL && env.LDAP_BIND_DN && env.LDAP_BIND_PASSWORD && env.LDAP_BASE_DN
        ? createLdapAuthenticator({
            url: env.LDAP_URL,
            bindDn: env.LDAP_BIND_DN,
            bindPassword: env.LDAP_BIND_PASSWORD,
            baseDn: env.LDAP_BASE_DN,
            userFilter: env.LDAP_USER_FILTER,
          })
        : undefined;
    const app = await buildApp({
      userStore: directory,
      registrationStore: directory,
      adminSetupStore: directory,
      accountDeletionStore: directory,
      invitationStore: directory,
      tokenStore: directory.tokens,
      checkDatabase: () => directory.check(),
      directory: ldap,
      saveDirectoryAccount: (input) => directory.saveDirectoryAccount(input),
    });

    const seeded = await applySeedUsers(directory, env);
    const expired = await directory.tokens.deleteExpired(Math.floor(Date.now() / 1000) - 24 * 60 * 60);
    app.log.info({ seeded, expiredTokens: expired }, "app user seed complete");
    await app.ready();
    return { app, directory };
  } catch (error) {
    await directory.close();
    throw error;
  }
}
