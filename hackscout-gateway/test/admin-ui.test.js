const assert = require("node:assert/strict");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { loadBrowserScripts } = require("./browser-script-loader");

function createPage(session, setupRequired) {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: "", hidden: false, disabled: false, textContent: "", innerHTML: "",
      dataset: {}, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(event, listener) { this.listeners[event] = listener; },
      focus() {},
    });
    return elements.get(selector);
  }
  const calls = [];
  const context = vm.createContext({
    document: { querySelector: element },
    console: { error() {} },
    AbortController, URLSearchParams, setTimeout: () => 1, setInterval: () => 1,
    clearTimeout() {}, clearInterval() {},
    fetch: async (url, options = {}) => {
      const action = url.split("/api/hackscout/admin/")[1];
      calls.push({ action, options });
      if (action === "auth/session") return Response.json(session.signedIn ? { user: { email: "fixture@example.test", role: "admin" } } : { error: "Sign in" }, { status: session.signedIn ? 200 : 401 });
      if (action === "auth/access") return Response.json({ email: "fixture@example.test", passwordSetupRequired: setupRequired });
      if (action === "auth/login" || action === "auth/create-password") {
        session.signedIn = true;
        return Response.json({ user: { email: "fixture@example.test", role: "admin" } });
      }
      if (action === "auth/logout") { session.signedIn = false; return Response.json({ ok: true }); }
      if (action === "pipeline") return Response.json({ job: null });
      if (action === "pipeline/schedule") return Response.json({ schedule: { frequency: "off", keyConfigured: false } });
      if (action.startsWith("suggestions?")) return Response.json({ items: [], total: 0, pageSize: 12 });
      throw new Error(`Unexpected test request: ${action}`);
    },
  });
  loadBrowserScripts(join(__dirname, "..", "..", "admin-ui"), context);
  const submit = () => element("#login-form").listeners.submit({ preventDefault() {} });
  const ready = () => new Promise((resolve) => setImmediate(resolve));
  return { element, calls, submit, ready };
}

test("admin email-first setup confirms password, signs in, restores session and signs out", async () => {
  const session = { signedIn: false };
  const page = createPage(session, true);
  await page.ready();
  page.element("#email").value = "fixture@example.test";
  await page.submit();
  assert.equal(page.element("#confirm-password-field").hidden, false);
  assert.equal(page.element("#login-submit").textContent, "Create password");
  page.element("#password").value = "correct-password";
  page.element("#confirm-password").value = "different-password";
  await page.submit();
  assert.equal(page.element("#notification").textContent, "Passwords do not match.");
  assert.equal(page.calls.some(({ action }) => action === "auth/create-password"), false);
  page.element("#confirm-password").value = "correct-password";
  await page.submit();
  assert.equal(page.element("#dashboard").hidden, false);
  assert.equal(page.element("#password").value, "");
  const reload = createPage(session, true);
  await reload.ready();
  assert.equal(reload.element("#dashboard").hidden, false);
  await reload.element("#logout").listeners.click();
  assert.equal(session.signedIn, false);
  assert.equal(reload.element("#password-field").hidden, true);
  assert.equal(reload.element("#login-submit").textContent, "Continue");
  for (const { options } of page.calls) {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers?.Authorization, undefined);
  }
});

test("existing admins sign in with a password and can change email", async () => {
  const page = createPage({ signedIn: false }, false);
  await page.ready();
  page.element("#email").value = "fixture@example.test";
  await page.submit();
  assert.equal(page.element("#confirm-password-field").hidden, true);
  assert.equal(page.element("#login-submit").textContent, "Sign in");
  page.element("#change-email").listeners.click();
  assert.equal(page.element("#email").readOnly, false);
  await page.submit();
  page.element("#password").value = "correct-password";
  await page.submit();
  assert.equal(page.calls.some(({ action }) => action === "auth/login"), true);
  assert.equal(page.element("#dashboard").hidden, false);
});
