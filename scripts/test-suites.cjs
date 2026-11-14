const { readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2];
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function files(directory, pattern) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name, pattern) : pattern.test(entry.name) ? [name] : [];
  }).sort();
}
if (mode === "node") {
  if (!process.env.npm_execpath) throw new Error("Run this suite using npm run test:node.");
  for (const component of ["services/hackathon-service", "jwt-service", "gateway", "scraper", "hackscout-gateway"]) {
    run(process.execPath, [process.env.npm_execpath, "test", "--prefix", component]);
  }
  run(process.execPath, ["--test", path.join("tests", "runtime", "harness.test.cjs")]);
} else if (mode === "sql") {
  run(process.execPath, ["--test", "--test-concurrency=1",
    ...files(path.join("scripts", "test"), /\.test\.cjs$/),
    ...files(path.join("supabase", "functions"), /_test\.cjs$/)]);
} else if (mode === "edge") {
  const deno = require("./deno-binary.cjs")();
  run(deno, ["check", "--no-lock", "--node-modules-dir=none",
    path.join("supabase", "functions", "scraper", "index.ts"),
    path.join("supabase", "functions", "etl", "index.ts")]);
  run(deno, ["test", "--no-lock", "--node-modules-dir=none", "--allow-env", "--allow-net", "--allow-read",
    ...files(path.join("supabase", "functions"), /_test\.(?:ts|js)$/)]);
} else {
  throw new Error("Choose node, sql, or edge.");
}
