const { cp, mkdir, mkdtemp, rm, symlink } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, randomUUID } = require("node:crypto");
const { root, ports, urls, accounts, localStatus, database, safeEnvironment } = require("./local-config.cjs");
const { initialize } = require("./schema.cjs");
const { startProviders } = require("./providers.cjs");
const { supervisor } = require("./processes.cjs");
const denoBinary = require("../../scripts/deno-binary.cjs");
const withoutEnvironment = (source) => !path.relative(root, source).split(path.sep).some((part) =>
  part.startsWith(".env") || ["node_modules", "test", ".data", ".vercel"].includes(part));
async function startStack() {
  const status = localStatus();
  const sql = database(status.DB_URL);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "hackscout-runtime-"));
  const secret = randomUUID() + randomUUID();
  const jwtSecret = randomUUID() + randomUUID();
  const encryption = randomBytes(32).toString("base64");
  const manager = await supervisor([secret, jwtSecret, encryption, status.DB_URL, status.SERVICE_ROLE_KEY, accounts.password]);
  let stopProviders;
  async function close() {
    try { await manager.close(); }
    finally {
      try { if (stopProviders) await stopProviders(); }
      finally { await sql.end(); await rm(temporary, { recursive: true, force: true }); }
    }
  }
  try {
    await initialize(sql, status);
    stopProviders = await startProviders(secret);
    const base = { ...safeEnvironment(), NODE_ENV: "test", GATEWAY_INTERNAL_SECRET: secret,
      DATABASE_URL: status.DB_URL, AUTH_DATABASE_URL: status.DB_URL, DATABASE_SSL: "false",
      JWT_SECRET: jwtSecret, LOG_LEVEL: "warn", BCRYPT_ROUNDS: "4",
      SEED_ADMIN_EMAIL: accounts.admin, SEED_ADMIN_PASSWORD: accounts.password };
    async function copyService(component, compiled) {
      const source = path.join(root, component);
      const target = path.join(temporary, component);
      await mkdir(target, { recursive: true });
      if (compiled) {
        await cp(path.join(source, "package.json"), path.join(target, "package.json"));
        await cp(path.join(source, "dist"), path.join(target, "dist"), { recursive: true });
      } else {
        await cp(source, target, { recursive: true, filter: withoutEnvironment });
      }
      await symlink(path.join(source, "node_modules"), path.join(target, "node_modules"),
        process.platform === "win32" ? "junction" : "dir");
      return target;
    }
    const gateway = await copyService("gateway", true);
    const jwt = await copyService("jwt-service", true);
    const hackathon = await copyService(path.join("services", "hackathon-service"), true);
    const web = await copyService("hackscout-gateway", false);
    for (const assets of ["hackscout-ui", "admin-ui"]) {
      await cp(path.join(root, assets), path.join(temporary, assets), { recursive: true, filter: withoutEnvironment });
    }
    const headers = { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": secret };
    const entries = [
      ["jwt", jwt, { ...base, PORT: String(ports.jwt) }],
      ["hackathon", hackathon, { ...base, PORT: String(ports.hackathon) }],
      ["gateway", gateway, { ...base, PORT: String(ports.gateway), RATE_LIMIT_MAX: "10000",
        JWT_SERVICE_URL: urls.jwt, HACKATHON_SERVICE_URL: urls.hackathon, HACKSCOUT_SERVICE_URL: urls.web,
        PIPELINE_SERVICE_URL: urls.scraper, SCRAPER_SERVICE_URL: urls.scraper, ETL_SERVICE_URL: urls.etl }],
    ];
    for (const [name, cwd, env] of entries) {
      const record = manager.launch(name, process.execPath, [path.join(cwd, "dist", "index.js")], cwd, env);
      await manager.ready(record, `${urls[name]}/${name === "gateway" ? "health/live" : "health"}`, headers);
    }
    const edgeEnvironment = { ...base, CI_RUNTIME_MODE: "disposable", EDGE_DATABASE_URL: status.DB_URL,
      CI_STORAGE_URL: status.API_URL, SUPABASE_URL: "https://storage.ci.test",
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, CI_PROVIDER_URL: urls.providers,
      AI_BASE_URL: `${urls.providers}/v1`, AUTH_GATEWAY_URL: urls.gateway, ALLOW_LOCAL_GATEWAY: "true",
      PIPELINE_KEY_ENCRYPTION_KEY: encryption, AI_API_KEY: "ci-fixture-key" };
    for (const name of ["scraper", "etl"]) {
      const record = manager.launch(name, denoBinary(), ["run", "--no-lock", "--node-modules-dir=none",
        "--config", path.join(__dirname, "deno.json"), "--allow-env", "--allow-net", "--allow-read",
        path.join(__dirname, "edge-bootstrap.ts")], temporary,
      { ...edgeEnvironment, CI_EDGE_KIND: name, PORT: String(ports[name]) });
      await manager.ready(record, `${urls[name]}/health`, headers);
    }
    const frontend = manager.launch("web", process.execPath, [path.join(web, "server.js")], web,
      { ...base, PORT: String(ports.web), VERCEL: "1", AUTH_GATEWAY_URL: urls.gateway,
        PIPELINE_SERVICE_URL: urls.scraper });
    await manager.ready(frontend, urls.web, {});
    return { close, environment: { ...safeEnvironment(), CI_DATABASE_URL: status.DB_URL,
      CI_RUNTIME_SECRET: secret, CI_STORAGE_URL: status.API_URL, CI_STORAGE_KEY: status.SERVICE_ROLE_KEY } };
  } catch (error) { await close(); throw error; }
}
module.exports = { startStack };
