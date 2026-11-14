const { existsSync, cpSync, readdirSync, mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { safeEnvironment } = require("../tests/runtime/local-config.cjs");
const root = path.resolve(__dirname, "..");
for (const component of ["ETL", path.join("services", "mail-service")]) {
  const cwd = path.join(root, component);
  const local = path.join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python");
  const executable = process.env.PYTHON ?? (existsSync(local) ? local : "python");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "hackscout-python-tests-"));
  let result;
  try {
    for (const entry of readdirSync(cwd)) {
      if (entry.endsWith(".py") || ["app", "tests"].includes(entry)) {
        cpSync(path.join(cwd, entry), path.join(temporary, entry), { recursive: true,
          filter: (source) => !source.split(path.sep).includes("__pycache__") });
      }
    }
    result = spawnSync(executable, ["-m", "unittest", "discover", "-s", "tests", "-v"], {
      cwd: temporary, stdio: "inherit", env: { ...safeEnvironment(),
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54329/postgres",
        MONGODB_CONNECTION_STRING: "mongodb://127.0.0.1:27017", AI_API_KEY: "",
        GATEWAY_INTERNAL_SECRET: "only-a-synthetic-test-secret", LDAP_URL: "",
        SMTP_HOST: "smtp.example.test", SMTP_FROM: "ci@example.test", SMTP_USER: "", SMTP_PASSWORD: "" },
    });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
