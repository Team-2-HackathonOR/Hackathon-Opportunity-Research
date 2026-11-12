const assert = require("node:assert/strict");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { loadBrowserScripts } = require("./browser-script-loader");

function createPage({ listingData = [], savedEntries = [] } = {}) {
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
  const storage = new Map([["hackscout-saved", '["1","2"]'], ["unrelated-setting", "preserve"], ...savedEntries]);
  const calls = [];
  let deletionFails = false;
  let loginUser = { id: "account-a", email: "fixture@example.test", role: "viewer" };
  let listings = () => Response.json({ data: listingData, next_after_id: null });
  const context = vm.createContext({
    document: {
      querySelector: element, querySelectorAll: () => [], getElementById: (id) => element(`#${id}`),
      addEventListener() {},
    },
    window: { scrollTo() {} }, console: { error() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key),
      get length() { return storage.size; }, key: (index) => [...storage.keys()][index] ?? null,
    },
    URL, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith("/api/hackscout/hackathons")) return listings(url);
      if (url.endsWith("/login")) return Response.json({ token: "fixture", user: loginUser });
      if (url.endsWith("/logout")) return Response.json({ ok: true });
      if (url.endsWith("/account")) return Response.json(deletionFails ? { error: "Current password is incorrect." } : { deleted: true }, { status: deletionFails ? 403 : 200 });
      throw new Error(`Unexpected test request: ${url}`);
    },
  });
  loadBrowserScripts(join(__dirname, "..", "..", "hackscout-ui"), context);
  const submit = (id) => element(id).listeners.submit({ preventDefault() {} });
  const login = async (id = "account-a") => {
    loginUser = { id, email: `${id}@example.test`, role: "viewer" };
    element("#account-email").value = loginUser.email;
    element("#account-password").value = "correct-password";
    await submit("#account-form");
  };
  return {
    element, calls, storage, submit, login, failDeletion() { deletionFails = true; },
    run: (source) => vm.runInContext(source, context),
    setListings(handler) { listings = handler; },
  };
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
  assert.match(page.element("#account-menu").textContent, /account-a@example.test/);
  assert.equal(page.element("#delete-account-password").value, "");
});

const listing = (id) => ({ event_id: id, event_name: `Hackathon ${id}`, format: "virtual" });

test("saved events are isolated between accounts and guests, including sign-out", async () => {
  const page = createPage({ listingData: [listing(1), listing(2)], savedEntries: [
    ["hackscout-saved:guest", '["2"]'],
  ] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.element("#saved-count").textContent, 1);
  await page.login();
  assert.equal(page.element("#saved-count").textContent, 0);
  page.run('toggleSaved("1")');
  assert.equal(page.storage.get("hackscout-saved:user:account-a"), '["1"]');
  await page.element("#account-menu").listeners.click();
  assert.equal(page.element("#saved-count").textContent, 1);
  assert.equal(page.run('saved.has("1")'), false);
  await page.login("account-b");
  assert.equal(page.element("#saved-count").textContent, 0);
  page.run('toggleSaved("2")');
  await page.element("#account-menu").listeners.click();
  await page.login("account-a");
  assert.equal(page.run('JSON.stringify([...saved])'), '["1"]');
  assert.equal(page.storage.get("hackscout-saved:user:account-b"), '["2"]');
});

test("deleted listings are pruned from the active account and persisted", async () => {
  const page = createPage({ listingData: [listing(1)], savedEntries: [
    ["hackscout-saved:user:account-a", '["1","2"]'],
  ] });
  await new Promise((resolve) => setImmediate(resolve));
  await page.login();
  assert.equal(page.element("#saved-count").textContent, 1);
  assert.equal(page.storage.get("hackscout-saved:user:account-a"), '["1"]');
  page.setListings(() => Response.json({ data: [], next_after_id: null }));
  await page.run("loadHackathons()");
  assert.equal(page.element("#saved-count").textContent, 0);
  assert.equal(page.storage.get("hackscout-saved:user:account-a"), "[]");
});

test("pagination preserves saved events beyond the first page and failed refreshes never prune", async () => {
  const page = createPage({ savedEntries: [["hackscout-saved:user:account-a", '["101","999"]']] });
  page.setListings((url) => new URL(url, "https://example.test").searchParams.get("after_event_id") === "0"
    ? Response.json({ data: Array.from({ length: 100 }, (_, index) => listing(index + 1)), next_after_id: 100 })
    : Response.json({ data: [listing(101)], next_after_id: null }));
  await new Promise((resolve) => setImmediate(resolve));
  await page.run("loadHackathons()");
  await page.login();
  assert.equal(page.storage.get("hackscout-saved:user:account-a"), '["101"]');
  page.setListings(() => Response.json({ error: "offline" }, { status: 503 }));
  await page.run("loadHackathons()");
  assert.equal(page.storage.get("hackscout-saved:user:account-a"), '["101"]');
  assert.equal(page.element("#saved-count").textContent, 1);
});

test("clear browser data removes all scoped saves but leaves unrelated storage", async () => {
  const page = createPage({ savedEntries: [
    ["hackscout-saved:user:account-a", '["1"]'], ["hackscout-saved:user:account-b", '["2"]'],
    ["hackscout-saved:guest", '["3"]'],
  ] });
  page.run("clearHackScoutBrowserData()");
  assert.deepEqual([...page.storage.keys()], ["unrelated-setting"]);
});
