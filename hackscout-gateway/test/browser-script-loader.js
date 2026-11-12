const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function getBrowserScriptPaths(directory) {
  const html = readFileSync(join(directory, "index.html"), "utf8");
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, source]) => source);
}

function loadBrowserScripts(directory, context) {
  for (const source of getBrowserScriptPaths(directory)) {
    const file = join(directory, source);
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  }
}

module.exports = { getBrowserScriptPaths, loadBrowserScripts };
