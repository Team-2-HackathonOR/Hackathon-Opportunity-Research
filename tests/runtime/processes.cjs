const { spawn } = require("node:child_process");
const { mkdir, appendFile } = require("node:fs/promises");
const path = require("node:path");
const { root } = require("./local-config.cjs");
async function supervisor(redactions) {
  const directory = path.join(root, "test-results", "runtime");
  await mkdir(directory, { recursive: true });
  const children = [];
  let writes = Promise.resolve();
  const sanitize = (line) => redactions.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, line);
  function launch(name, command, args, cwd, env) {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const record = { name, child, failure: null, tail: "" };
    children.push(record);
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      const flush = (line) => {
        const clean = sanitize(line);
        record.tail = (record.tail + clean).slice(-4000);
        writes = writes.then(() => appendFile(path.join(directory, `${name}.log`), clean));
      };
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        pending += chunk;
        const last = pending.lastIndexOf("\n");
        if (last >= 0) { flush(pending.slice(0, last + 1)); pending = pending.slice(last + 1); }
      });
      stream.on("end", () => { if (pending) flush(pending); });
    }
    child.on("error", (error) => { record.failure = error; });
    return record;
  }
  async function ready(record, url, headers) {
    const deadline = Date.now() + 60000;
    let failure = "not ready";
    while (Date.now() < deadline) {
      if (record.failure || record.child.exitCode !== null || record.child.signalCode !== null) {
        throw new Error(`${record.name} exited during startup: ${record.failure?.message ?? record.tail}`);
      }
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
        failure = `HTTP ${response.status}`;
      } catch (error) { failure = error.message; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`${record.name} readiness timed out (${failure}). ${record.tail}`);
  }
  async function close() {
    for (const { child } of children.reverse()) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      const exit = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exit;
      clearTimeout(timer);
    }
    await writes;
  }
  return { launch, ready, close };
}
module.exports = { supervisor };
