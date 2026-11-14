const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..", "..");
const ports = { gateway: 43100, jwt: 43101, hackathon: 43102, scraper: 43103, web: 43104, etl: 43105, providers: 43106 };
const urls = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]));
const accounts = { admin: "ci-admin@example.test", password: "Disposable-test-password-123!" };
function safeEnvironment() {
  const environment = {};
  for (const name of ["PATH", "Path", "SystemRoot", "ComSpec", "HOME", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
function localStatus() {
  const result = spawnSync("supabase", ["status", "--workdir", path.join(root, "tests", "runtime"), "-o", "json"],
    { encoding: "utf8", env: safeEnvironment() });
  if (result.error || result.status !== 0) {
    throw new Error("Start the disposable tests/runtime Supabase project first; Docker and the Supabase CLI are required.");
  }
  const status = JSON.parse(result.stdout);
  for (const [key, port, protocols] of [
    ["API_URL", "54328", ["http:"]], ["DB_URL", "54329", ["postgres:", "postgresql:"]],
  ]) {
    const url = new URL(status[key]);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== port || !protocols.includes(url.protocol)) {
      throw new Error("Refusing non-fixture infrastructure. Production URLs and credentials are not accepted.");
    }
  }
  if (typeof status.SERVICE_ROLE_KEY !== "string" || !status.SERVICE_ROLE_KEY) {
    throw new Error("The local Supabase status did not provide a Storage service key.");
  }
  return status;
}
function database(connectionString) {
  const { Pool } = require(path.join(root, "jwt-service", "node_modules", "pg"));
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "54329") {
    throw new Error("Refusing a database outside the disposable fixture.");
  }
  return new Pool({ connectionString, ssl: false, max: 3 });
}
module.exports = { root, ports, urls, accounts, localStatus, database, safeEnvironment };
