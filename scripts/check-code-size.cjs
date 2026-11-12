const { execFileSync } = require("node:child_process");
const { readFileSync, statSync } = require("node:fs");
const { extname, resolve, basename } = require("node:path");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root, encoding: "utf8",
}).split("\0").filter(Boolean);
const extensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".pyi", ".sql", ".html",
  ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".sh", ".ps1", ".bat",
  ".go", ".java", ".cs", ".c", ".h", ".cpp", ".hpp", ".rs", ".rb", ".php",
  ".yml", ".yaml",
]);
const violations = [];
let checked = 0;
for (const file of new Set(files)) {
  if (!extensions.has(extname(file)) && !["Dockerfile", "Makefile"].includes(basename(file))) continue;
  const absolute = resolve(root, file);
  let stat;
  try { stat = statSync(absolute); }
  catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (!stat.isFile()) continue;
  const text = readFileSync(absolute, "utf8");
  const lines = text.length ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0;
  checked++;
  if (lines > 200) violations.push(`${file}: ${lines} lines`);
}
if (violations.length) {
  console.error(`Code files must contain at most 200 lines:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Checked ${checked} repository code files: all contain at most 200 lines.`);
