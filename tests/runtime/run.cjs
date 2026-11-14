const { spawn } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { root } = require("./local-config.cjs");
const { startStack } = require("./stack.cjs");
async function main() {
  const mode = process.argv[2];
  if (!["api", "serve"].includes(mode)) throw new Error("Choose api or serve.");
  const stack = await startStack();
  let closing;
  const close = () => closing ??= stack.close();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { close().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); }); });
  }
  console.log("Disposable runtime ready; no production configuration was loaded.");
  if (mode === "serve") return;
  try {
    const files = readdirSync(path.join(__dirname, "..", "api")).filter((file) => file.endsWith(".test.cjs")).sort();
    if (files.length < 3) throw new Error("API journey inventory is incomplete.");
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec",
      "--test-reporter-destination=stdout", "--test-reporter=junit",
      "--test-reporter-destination=test-results/api.xml", ...files.map((file) =>
      path.join(__dirname, "..", "api", file))], { cwd: root, env: stack.environment, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally { await close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
