const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { assert, accounts, connect, call, login, urls } = require("./helpers.cjs");
test("vertical: register, persist viewer identity, revoke a session, and delete only the verified account", async () => {
  const db = connect();
  const email = `ci-${randomUUID()}@example.test`;
  try {
    await call("/api/auth/me", 401);
    await call("/api/auth/register", 400, { method: "POST",
      body: { email, password: accounts.password, role: "admin" } });
    const registered = await call("/api/auth/register", 201,
      { method: "POST", body: { email, password: accounts.password } });
    assert.equal(registered.user.role, "viewer");
    const persisted = (await db.query("SELECT id,role FROM app_auth.app_users WHERE email=$1", [email])).rows;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].id, registered.user.id);
    assert.equal(persisted[0].role, "viewer");
    await call("/api/hackscout/admin/suggestions", 403, { token: registered.token,
      headers: { "x-user-role": "admin", "x-user-id": randomUUID() } });
    await call("/api/hackathons", 403, { base: urls.hackathon,
      headers: { "x-user-role": "admin", "x-gateway-caller": "team-2-gateway" } });
    await call("/api/auth/logout", 200, { method: "POST", token: registered.token, body: {} });
    await call("/api/auth/me", 401, { token: registered.token });
    const session = await login(email);
    const invalid = { method: "DELETE", token: session.token,
      body: { password: "incorrect-password", confirmation: "DELETE" } };
    await call("/api/auth/account", 403, invalid);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM app_auth.app_users WHERE email=$1", [email])).rows[0].n, 1);
    await call("/api/auth/account", 200, { ...invalid, body: { password: accounts.password, confirmation: "DELETE" } });
    await call("/api/auth/me", 401, { token: session.token });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM app_auth.app_users WHERE email=$1", [email])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM app_auth.jwt_tokens WHERE user_id=$1",
      [registered.user.id])).rows[0].n, 0);
  } finally {
    await db.query("DELETE FROM app_auth.jwt_tokens WHERE user_id IN (SELECT id FROM app_auth.app_users WHERE email=$1)", [email]);
    await db.query("DELETE FROM app_auth.app_users WHERE email=$1", [email]);
    await db.end();
  }
});
