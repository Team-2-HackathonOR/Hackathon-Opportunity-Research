const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startProviders } = require("./providers.cjs");
const { database, urls, root, safeEnvironment } = require("./local-config.cjs");
const denoBinary = require("../../scripts/deno-binary.cjs");

test("runtime database guard refuses hosted databases and unrelated local projects before connecting", () => {
  for (const url of ["postgresql://user:unused@db.example.test:54329/postgres",
    "postgresql://user:unused@127.0.0.1:5432/postgres"]) {
    assert.throws(() => database(url), /outside the disposable fixture/);
  }
});

test("Edge transport adapter refuses non-fixture infrastructure before importing handlers", () => {
  const result = spawnSync(denoBinary(), ["run", "--no-lock", "--node-modules-dir=none", "--allow-env",
    "--config", path.join(__dirname, "deno.json"), path.join(__dirname, "edge-bootstrap.ts")], {
    cwd: root, encoding: "utf8", timeout: 15000, env: { ...safeEnvironment(),
      CI_RUNTIME_MODE: "disposable", EDGE_DATABASE_URL: "postgresql://unused@db.example.test:54329/postgres",
      CI_STORAGE_URL: "http://127.0.0.1:54328", CI_PROVIDER_URL: urls.providers },
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refuses non-disposable infrastructure/);
});

test("fixture providers paginate, emit one retryable 503, recover, and return a malformed-record completion", async () => {
  const stop = await startProviders("only-a-disposable-test-secret");
  try {
    const first = await (await fetch(`${urls.providers}/api/hackathons?page=1`)).json();
    const second = await (await fetch(`${urls.providers}/api/hackathons?page=2&ci_case=isolated`)).json();
    assert.equal(first.meta.total_pages, 2);
    assert.deepEqual(first.hackathons.map((item) => item.id), [11, 12]);
    assert.ok(second.hackathons[0].title.endsWith("isolated"));
    assert.ok(second.hackathons[1].submission_period_dates.includes("2011"));
    const complete = (name, key = "ci-fixture-key") => fetch(`${urls.providers}/v1/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content:
        `Base draft:\n${JSON.stringify({ event_name: name })}\nRaw source:\n{}` }] }),
    });
    const unauthorized = await complete("CI pipeline first", "wrong-fixture-key");
    assert.equal(unauthorized.status, 401);
    await unauthorized.body.cancel();
    const transient = await complete("CI pipeline first");
    assert.equal(transient.status, 503);
    await transient.body.cancel();
    const success = await complete("CI pipeline first");
    assert.equal(success.status, 200);
    assert.equal(JSON.parse((await success.json()).choices[0].message.content).event_name, "CI pipeline first");
    const malformed = await complete("CI malformed lead");
    assert.equal(malformed.status, 200);
    const invalid = (await malformed.json()).choices[0].message.content;
    assert.throws(() => JSON.parse(invalid), SyntaxError);
  } finally { await stop(); }
});
