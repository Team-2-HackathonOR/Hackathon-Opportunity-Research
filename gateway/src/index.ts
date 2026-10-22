import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down gateway");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  const logTarget = env.LOG_FILE_PATH ? "stdout and file" : "stdout";
  app.log.info(
    { port: env.PORT, service: env.SERVICE_NAME, logFile: env.LOG_FILE_PATH ?? null },
    `gateway listening; logging to ${logTarget}`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
