const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createAuthRouter } = require("../auth");

test("HackScout auth proxy forwards only supported routes without exposing gateway secrets", async (t) => {
  const app = express();
  app.use("/api/auth", createAuthRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const realFetch = global.fetch;
  const calls = [];
  t.mock.method(global, "fetch", async (url, options) => {
    if (String(url).startsWith(root)) return realFetch(url, options);
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ token: "fixture-token", user: { role: "viewer" } }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  });
  const payload = { email: "new@example.com", password: "password-fixture" };
  const response = await fetch(`${root}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json", "x-user-role": "admin" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls[0].url.pathname, "/api/auth/register");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.equal(calls[0].options.headers["x-user-role"], undefined);
  const denied = await fetch(`${root}/api/auth/invitations`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(denied.status, 404);
  assert.equal(calls.length, 1);
  const deletion = await fetch(`${root}/api/auth/account`, {
    method: "DELETE", headers: { "content-type": "application/json", authorization: "Bearer fixture" },
    body: JSON.stringify({ password: "current-password", confirmation: "DELETE" }),
  });
  assert.equal(deletion.status, 201);
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[1].url.pathname, "/api/auth/account");
  assert.deepEqual(JSON.parse(calls[1].options.body), { password: "current-password", confirmation: "DELETE" });
});
