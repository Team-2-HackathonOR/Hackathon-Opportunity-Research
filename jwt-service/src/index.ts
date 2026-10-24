import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { createPgUserDirectory } from "./db/users.js";
import { createLdapAuthenticator } from "./lib/ldap.js";
import { applySeedUsers } from "./lib/seed.js";

const directory = createPgUserDirectory(env);
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
  invitationStore: directory,
  tokenStore: directory.tokens,
  checkDatabase: () => directory.check(),
  directory: ldap,
  saveDirectoryAccount: (input) => directory.saveDirectoryAccount(input),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down jwt-service");
  await app.close();
  await directory.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const seeded = await applySeedUsers(directory, env);
  const expired = await directory.tokens.deleteExpired(Math.floor(Date.now() / 1000) - 24 * 60 * 60);
  app.log.info({ seeded, expiredTokens: expired }, "app user seed complete");
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  const logTarget = env.LOG_FILE_PATH ? "stdout and file" : "stdout";
  app.log.info(
    { port: env.PORT, service: env.SERVICE_NAME, logFile: env.LOG_FILE_PATH ?? null },
    `jwt-service listening; logging to ${logTarget}`,
  );
} catch (err) {
  app.log.error(err);
  await directory.close();
  process.exit(1);
}
