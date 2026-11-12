const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requireGateway } = require("../gateway-auth");

test("HackScout API only accepts the main gateway's trusted caller", (t) => {
  const previous = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = "gateway-test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previous;
  });
  t.mock.method(console, "warn", () => {});
  let status;
  let nextCalled = false;
  const response = { status(code) { status = code; return this; }, json() {} };
  requireGateway({ get: () => undefined }, response, () => { nextCalled = true; });
  assert.equal(status, 403);
  assert.equal(nextCalled, false);
  requireGateway({
    get: (name) => name === "x-gateway-secret" ? "gateway-test-secret" : "team-2-gateway",
  }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
