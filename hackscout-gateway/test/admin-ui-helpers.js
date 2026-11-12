const { join } = require("node:path");
const vm = require("node:vm");
const { loadBrowserScripts } = require("./browser-script-loader");

function createPage(session, setupRequired, responses = {}, confirm = () => true) {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: "", hidden: false, disabled: false, textContent: "", innerHTML: "",
        dataset: {}, listeners: {},
        classList: {
          toggle(name, force) {
            const enabled = force === undefined ? !classes.has(name) : Boolean(force);
            if (enabled) classes.add(name); else classes.delete(name);
            return enabled;
          },
          add(...names) { names.forEach((name) => classes.add(name)); },
          remove(...names) { names.forEach((name) => classes.delete(name)); },
          contains(name) { return classes.has(name); },
        },
        addEventListener(event, listener) { this.listeners[event] = listener; },
        focus() {},
      });
    }
    return elements.get(selector);
  }
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document: { querySelector: element },
    console: { error() {} },
    confirm,
    AbortController, URLSearchParams, setInterval: () => 1,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, clearInterval() {},
    fetch: async (url, options = {}) => {
      const action = url.split("/api/hackscout/admin/")[1];
      calls.push({ action, options });
      if (responses[action]) return responses[action]();
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
  const request = (route) => vm.runInContext("api", context)(route);
  const renderPipeline = (job) => vm.runInContext("showPipeline", context)(job);
  const runTimers = async () => {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) await callback();
  };
  return { element, calls, submit, ready, request, renderPipeline, runTimers };
}

module.exports = { createPage };
