const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const express = require("express");
const { createAuthRouter } = require("../auth");

test("login proxy forwards only supported authentication operations", async (t) => {
  const upstream = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(request.url.endsWith("/login") ? 401 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      path: request.url, method: request.method, authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : undefined,
    }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const oldUrl = process.env.AUTH_GATEWAY_URL;
  process.env.AUTH_GATEWAY_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = express();
  app.use("/api/auth", createAuthRouter());
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    if (oldUrl === undefined) delete process.env.AUTH_GATEWAY_URL;
    else process.env.AUTH_GATEWAY_URL = oldUrl;
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
  });
  const root = `http://127.0.0.1:${server.address().port}/api/auth`;
  const login = await fetch(`${root}/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.test", password: "fixture" }),
  });
  assert.equal(login.status, 401);
  assert.equal(login.headers.get("cache-control"), "no-store");
  assert.deepEqual(await login.json(), {
    path: "/api/auth/login", method: "POST", body: { email: "user@example.test", password: "fixture" },
  });
  for (const [route, method] of [["me", "GET"], ["logout", "POST"]]) {
    const result = await fetch(`${root}/${route}`, { method, headers: { authorization: "Bearer example-token" } });
    assert.deepEqual(await result.json(), {
      path: `/api/auth/${route}`, method, authorization: "Bearer example-token",
      ...(method === "POST" ? { body: {} } : {}),
    });
  }
  assert.equal((await fetch(`${root}/invitations`, { method: "POST" })).status, 404);
});

test("login UI routes each role and reports failed logins", async (t) => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "login-ui", "app.js"), "utf8");
  for (const role of ["admin", "viewer", "researcher", "invalid"]) {
    await t.test(role, async () => {
      const elements = Object.fromEntries(["login-form", "notification", "submit", "password", "email"].map((id) => [id, {}]));
      elements.email.value = " user@example.test ";
      elements.password.value = "fixture";
      elements["login-form"].addEventListener = (_name, callback) => { elements["login-form"].submit = callback; };
      let destination;
      const values = new Map();
      const context = {
        document: { querySelector: (selector) => elements[selector.slice(1)] },
        sessionStorage: { setItem: (key, value) => values.set(key, value) },
        window: { location: { assign: (url) => { destination = url; } } },
        console: { error() {} },
        fetch: async (url, options) => {
          assert.equal(url, "/api/auth/login");
          assert.deepEqual(JSON.parse(options.body), { email: "user@example.test", password: "fixture" });
          return { ok: role !== "invalid", status: 401, json: async () => role === "invalid"
            ? { error: "Invalid credentials." } : { token: "jwt-fixture", user: { role } } };
        },
      };
      vm.runInNewContext(script, context);
      await elements["login-form"].submit({ preventDefault() {} });
      assert.equal(elements.submit.disabled, false);
      if (role === "invalid") {
        assert.equal(elements.notification.textContent, "Invalid credentials.");
        assert.equal(values.size, 0);
        assert.equal(destination, undefined);
      } else {
        assert.equal(values.get("hackscout.jwt"), "jwt-fixture");
        assert.equal(elements.password.value, "");
        assert.equal(destination, role === "admin" ? "/admin/" : "/");
      }
    });
  }
});

test("admin restores and verifies the shared JWT before loading the queue", async (t) => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "admin-ui", "app.js"), "utf8");
  for (const status of [200, 401, 403]) {
    await t.test(`session verification ${status}`, async () => {
      const elements = new Map();
      const getElement = (selector) => {
        if (!elements.has(selector)) elements.set(selector, {
          value: selector === "#status-filter" ? "pending" : "",
          hidden: selector === "#dashboard",
          classList: { toggle() {} },
          addEventListener() {},
        });
        return elements.get(selector);
      };
      const values = new Map([["hackscout.jwt", "jwt-fixture"]]);
      const calls = [];
      const context = {
        document: { querySelector: getElement },
        sessionStorage: {
          getItem: (key) => values.get(key),
          removeItem: (key) => values.delete(key),
        },
        fetch: async (url, options) => {
          calls.push(url);
          assert.equal(options.headers.Authorization, "Bearer jwt-fixture");
          if (url === "/api/admin/session") return {
            ok: status === 200, status,
            json: async () => status === 200 ? { email: "admin@example.test", role: "admin" } : { error: "Access denied." },
          };
          return { ok: true, json: async () => ({ items: [], total: 0, pageSize: 12 }) };
        },
        console: { error() {} },
        AbortController, URLSearchParams, setTimeout, clearTimeout,
      };
      vm.runInNewContext(script, context);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getElement("#dashboard").hidden, status !== 200);
      assert.equal(calls.some((url) => url.startsWith("/api/admin/suggestions?")), status === 200);
      assert.equal(values.has("hackscout.jwt"), status !== 401);
    });
  }
});

test("login and admin pages are reachable through the public static proxy", async (t) => {
  let httpServer;
  try {
    httpServer = require.resolve("http-server/bin/http-server");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    t.skip("Root http-server dependency is not installed.");
    return;
  }
  const app = require("../server");
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const proxy = spawn(process.execPath, [
    httpServer, path.join(__dirname, "..", "..", "hackscout-ui"),
    "-p", "0", "-c-1", "-P", `http://127.0.0.1:${server.address().port}`,
  ]);
  t.after(async () => {
    proxy.kill();
    await new Promise((resolve) => server.close(resolve));
  });

  const output = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("Static proxy did not start.")), 5000);
    proxy.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("Available on:") && /http:\/\/127\.0\.0\.1:\d+/.test(text)) {
        clearTimeout(timer);
        resolve(text);
      }
    });
    proxy.on("error", reject);
    proxy.on("exit", (code) => reject(new Error(`Static proxy exited with ${code}.`)));
  });
  const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  for (const [url, expected] of [
    ["/login/", "Sign in to HackScout"],
    ["/login/app.js", "sessionStorage"],
    ["/login/account.js", "accountLogout"],
    ["/admin/", "HackScout Admin"],
  ]) {
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.status, 200, url);
    assert.ok((await response.text()).includes(expected), url);
  }
});

test("public UI requires a verified session and redirects after sign-out", async (t) => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "login-ui", "account.js"), "utf8");
  for (const status of [0, 200, 401, 502]) {
    await t.test(`session ${status || "missing"}`, async () => {
      const link = {};
      const logout = { hidden: true, addEventListener(_name, callback) { this.click = callback; } };
      const check = {};
      const app = { hidden: true };
      const elements = { "#account-link": link, "#account-logout": logout, "#auth-check": check, "#app": app };
      const values = new Map(status ? [["hackscout.jwt", "jwt-fixture"]] : []);
      const requests = [];
      let destination;
      let scriptLoaded = false;
      vm.runInNewContext(script, {
        document: {
          querySelector: (selector) => elements[selector],
          createElement: () => ({}),
          body: { appendChild(element) { scriptLoaded = true; element.onload(); } },
        },
        window: { location: { replace: (url) => { destination = url; } } },
        sessionStorage: { getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) },
        fetch: async (url, options) => {
          requests.push(url);
          assert.equal(options.headers.Authorization, "Bearer jwt-fixture");
          return { ok: status === 200, status, json: async () => url.endsWith("/me")
            ? { email: "viewer@example.test", role: "viewer" } : { status: "signed_out" } };
        },
        console: { error() {} },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(scriptLoaded, status === 200);
      assert.equal(app.hidden, status !== 200);
      if (status === 0 || status === 401) {
        assert.equal(destination, "/login/");
        assert.equal(values.has("hackscout.jwt"), false);
      } else if (status === 502) {
        assert.match(check.textContent, /Could not verify/);
        assert.equal(values.has("hackscout.jwt"), true);
      } else {
        assert.equal(link.textContent, "viewer@example.test (viewer)");
        await logout.click();
        assert.deepEqual(requests, ["/api/auth/me", "/api/auth/logout"]);
        assert.equal(values.has("hackscout.jwt"), false);
        assert.equal(destination, "/login/");
      }
    });
  }
});
