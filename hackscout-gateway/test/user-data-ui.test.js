const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function createPage() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: "", hidden: false, checked: false, disabled: false, textContent: "", innerHTML: "",
      dataset: {}, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(event, listener) { this.listeners[event] = listener; },
      querySelectorAll() { return []; }, setAttribute() {}, removeAttribute() {}, focus() {}, reset() {},
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return elements.get(selector);
  }
  const storage = new Map([["hackscout-saved", '["1","2"]'], ["unrelated-setting", "preserve"]]);
  const calls = [];
  let deletionFails = false;
  const context = vm.createContext({
    document: {
      querySelector: element, querySelectorAll: () => [], getElementById: (id) => element(`#${id}`),
      addEventListener() {},
    },
    window: { scrollTo() {} }, console: { error() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key),
    },
    URL, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("/api/hackscout/hackathons")) return Response.json({ data: [] });
      if (url.endsWith("/login")) return Response.json({ token: "fixture", user: { email: "fixture@example.test", role: "viewer" } });
      if (url.endsWith("/account")) return Response.json(deletionFails ? { error: "Current password is incorrect." } : { deleted: true }, { status: deletionFails ? 403 : 200 });
      throw new Error(`Unexpected test request: ${url}`);
    },
  });
  for (const file of ["app.js", "auth.js"]) {
    vm.runInContext(readFileSync(join(__dirname, "..", "..", "hackscout-ui", file), "utf8"), context);
  }
  const submit = (id) => element(id).listeners.submit({ preventDefault() {} });
  const login = async () => {
    element("#account-email").value = "fixture@example.test";
    element("#account-password").value = "correct-password";
    await submit("#account-form");
  };
  return { element, calls, storage, submit, login, failDeletion() { deletionFails = true; } };
}
test("clearing browser data requires confirmation, preserves unrelated storage and needs no account", async () => {
  const page = createPage();
  await new Promise((resolve) => setImmediate(resolve));
  page.element("#account-data-entry").listeners.click();
  assert.equal(page.element("#delete-account-form").hidden, true);
  page.element("#clear-browser-data").listeners.click();
  assert.equal(page.storage.get("hackscout-saved"), '["1","2"]');
  page.element("#clear-browser-confirm").checked = true;
  page.element("#clear-browser-data").listeners.click();
  assert.equal(page.storage.has("hackscout-saved"), false);
  assert.equal(page.storage.get("unrelated-setting"), "preserve");
  assert.equal(page.element("#saved-count").textContent, 0);
  assert.equal(page.calls.some(({ url }) => url.endsWith("/account")), false);
});
test("account deletion requires confirmation, uses the current session and leaves browser data separate", async () => {
  const page = createPage();
  await page.login();
  page.element("#account-data-open").listeners.click();
  assert.equal(page.element("#delete-account-form").hidden, false);
  await page.submit("#delete-account-form");
  assert.equal(page.calls.some(({ url }) => url.endsWith("/account")), false);
  page.element("#delete-account-confirmation").value = "DELETE";
  page.element("#delete-account-password").value = "correct-password";
  await page.submit("#delete-account-form");
  const request = page.calls.find(({ url }) => url.endsWith("/account"));
  assert.equal(request.options.method, "DELETE");
  assert.equal(request.options.headers.Authorization, "Bearer fixture");
  assert.deepEqual(JSON.parse(request.options.body), { password: "correct-password", confirmation: "DELETE" });
  assert.equal(page.element("#delete-account-form").hidden, true);
  assert.equal(page.element("#account-menu").textContent, "Sign in / Create account");
  assert.equal(page.element("#delete-account-password").value, "");
  assert.equal(page.storage.get("hackscout-saved"), '["1","2"]');
});
test("failed account deletion reports the error and keeps the user signed in", async () => {
  const page = createPage();
  await page.login();
  page.failDeletion();
  page.element("#account-data-open").listeners.click();
  page.element("#delete-account-confirmation").value = "DELETE";
  page.element("#delete-account-password").value = "wrong-password";
  await page.submit("#delete-account-form");
  assert.equal(page.element("#account-data-feedback").textContent, "Current password is incorrect.");
  assert.equal(page.element("#delete-account-form").hidden, false);
  assert.match(page.element("#account-menu").textContent, /fixture@example.test/);
  assert.equal(page.element("#delete-account-password").value, "");
});
