import { objectRecord } from "./storage-http.ts";

export function storageFixture() {
  const variables = {
    SUPABASE_URL: "https://storage-fixture.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-private-service-key",
    STAGING_STORAGE_BUCKET: "hackscout-staging",
    STAGING_STORAGE_PREFIX: "hackscout/raw",
  };
  const previous = Object.keys(variables).map((name) => [name, Deno.env.get(name)] as const);
  for (const [name, value] of Object.entries(variables)) Deno.env.set(name, value);
  const original = globalThis.fetch;
  const objects = new Map<string, unknown>();
  const calls: { method: string; path: string; body: unknown }[] = [];
  const state = { public: false, badUploadAck: false, badDeleteAck: false, failureStatus: 0 };
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== variables.SUPABASE_URL) throw new Error("Unexpected network destination in Storage test.");
    const headers = new Headers(init?.headers);
    if (headers.get("apikey") !== variables.SUPABASE_SERVICE_ROLE_KEY ||
        headers.get("authorization") !== `Bearer ${variables.SUPABASE_SERVICE_ROLE_KEY}`) throw new Error("Missing Storage server authentication.");
    const path = decodeURIComponent(url.pathname.slice("/storage/v1/".length));
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const reply = (value: unknown, status = 200) => Promise.resolve(Response.json(value, { status }));
    if (state.failureStatus) return reply({ statusCode: String(state.failureStatus), error: variables.SUPABASE_SERVICE_ROLE_KEY }, state.failureStatus);
    if (path === `bucket/${variables.STAGING_STORAGE_BUCKET}`) return reply({ public: state.public });
    if (path === `object/list/${variables.STAGING_STORAGE_BUCKET}` && objectRecord(body)) {
      if (typeof body.prefix !== "string" || typeof body.limit !== "number" || typeof body.offset !== "number") throw new Error("Invalid listing request.");
      const prefix = `${body.prefix}/`;
      const search = typeof body.search === "string" ? body.search : "";
      const names = new Map<string, { name: string; id: string | null }>();
      for (const key of objects.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name.includes(search)) names.set(name, { name, id: rest.includes("/") ? null : name });
      }
      return reply([...names.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(body.offset, body.offset + body.limit));
    }
    if (path === `object/${variables.STAGING_STORAGE_BUCKET}` && method === "DELETE" && objectRecord(body) && Array.isArray(body.prefixes)) {
      const removed = [];
      for (const name of body.prefixes) {
        if (typeof name !== "string") throw new Error("Invalid removal path.");
        if (objects.delete(name)) removed.push({ name });
      }
      return reply(state.badDeleteAck ? [] : removed);
    }
    const prefix = `object/${variables.STAGING_STORAGE_BUCKET}/`;
    if (path.startsWith(prefix)) {
      const name = path.slice(prefix.length);
      if (method === "POST") {
        objects.set(name, body);
        return reply({ Key: state.badUploadAck ? "wrong-key" : `${variables.STAGING_STORAGE_BUCKET}/${name}` });
      }
      if (method === "GET") return objects.has(name) ? reply(objects.get(name)) : reply({ statusCode: "404" }, 404);
    }
    throw new Error("Unexpected Storage API request.");
  };
  return {
    objects, calls, state,
    restore() {
      globalThis.fetch = original;
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
      }
    },
  };
}
