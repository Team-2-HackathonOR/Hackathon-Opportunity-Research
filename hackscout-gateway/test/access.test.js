const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const app = require("../server");

test("HackScout APIs require a valid session before accessing data", async (t) => {
  const auth = http.createServer((request, response) => {
    assert.equal(request.url, "/api/auth/me");
    const token = request.headers.authorization;
    const status = token === "Bearer valid" ? 200 : token === "Bearer offline" ? 503 : 401;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(status === 200 ? { email: "viewer@example.test", role: "viewer" } : { error: "Denied" }));
  });
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve));
  const previous = process.env.AUTH_GATEWAY_URL;
  const previousGraphql = process.env.SUPABASE_GRAPHQL_URL;
  const previousKey = process.env.SUPABASE_API_KEY;
  process.env.AUTH_GATEWAY_URL = `http://127.0.0.1:${auth.address().port}`;
  process.env.SUPABASE_GRAPHQL_URL = "https://example.test/graphql/v1";
  process.env.SUPABASE_API_KEY = "test-secret-key";
  const originalFetch = global.fetch;
  t.mock.method(global, "fetch", (url, options) => {
    if (String(url) === "https://example.test/graphql/v1") {
      return Promise.resolve(new Response(JSON.stringify({
        data: { eventsCollection: { edges: [], pageInfo: { hasNextPage: false } } },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return originalFetch(url, options);
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    if (previous === undefined) delete process.env.AUTH_GATEWAY_URL;
    else process.env.AUTH_GATEWAY_URL = previous;
    if (previousGraphql === undefined) delete process.env.SUPABASE_GRAPHQL_URL;
    else process.env.SUPABASE_GRAPHQL_URL = previousGraphql;
    if (previousKey === undefined) delete process.env.SUPABASE_API_KEY;
    else process.env.SUPABASE_API_KEY = previousKey;
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => auth.close(resolve))]);
  });
  const root = `http://127.0.0.1:${server.address().port}`;
  for (const [url, method] of [["/api/hackathons", "GET"], ["/api/suggestions", "POST"]]) {
    for (const [token, expected] of [["", 401], ["Bearer expired", 401], ["Bearer offline", 502]]) {
      const response = await fetch(`${root}${url}`, {
        method, headers: { ...(token ? { authorization: token } : {}), "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      assert.equal(response.status, expected, `${method} ${url} ${token}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  const valid = await fetch(`${root}/api/suggestions`, {
    method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json" }, body: "{}",
  });
  assert.equal(valid.status, 400);
  assert.match((await valid.json()).error, /valid event name/);
  const listings = await fetch(`${root}/api/hackathons`, { headers: { authorization: "Bearer valid" } });
  assert.equal(listings.status, 200);
  assert.deepEqual(await listings.json(), []);
});
