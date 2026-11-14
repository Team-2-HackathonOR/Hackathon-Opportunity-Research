const assert = require("node:assert/strict");
const { urls, accounts, database } = require("../runtime/local-config.cjs");
function connect() {
  if (!process.env.CI_DATABASE_URL) throw new Error("Run API journeys with npm run test:e2e:api.");
  return database(process.env.CI_DATABASE_URL);
}
async function call(route, status, { base = urls.web, method = "GET", body, token, headers = {} } = {}) {
  const response = await fetch(new URL(route, base), { method, signal: AbortSignal.timeout(120000),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${route}: HTTP ${response.status}; ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}
const login = (email = accounts.admin) => call("/api/auth/login", 200,
  { method: "POST", body: { email, password: accounts.password } });
const internal = () => {
  if (!process.env.CI_RUNTIME_SECRET) throw new Error("Missing runtime-only gateway credential.");
  return { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": process.env.CI_RUNTIME_SECRET };
};
module.exports = { assert, urls, accounts, connect, call, login, internal };
