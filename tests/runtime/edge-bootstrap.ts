const requireEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing test bootstrap ${name}.`);
  return value;
};
const database = new URL(requireEnv("EDGE_DATABASE_URL"));
const storage = new URL(requireEnv("CI_STORAGE_URL"));
const providers = new URL(requireEnv("CI_PROVIDER_URL"));
if (requireEnv("CI_RUNTIME_MODE") !== "disposable" || database.hostname !== "127.0.0.1" ||
    database.port !== "54329" || storage.origin !== "http://127.0.0.1:54328" ||
    providers.origin !== "http://127.0.0.1:43106") {
  throw new Error("Test bootstrap refuses non-disposable infrastructure.");
}
// Provider/DNS translation is fixture-only; production transport validation is unchanged.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === "https://storage.ci.test") {
    return nativeFetch(new Request(new URL(url.pathname + url.search, storage), request));
  }
  if (["devpost.com", "events.example.test"].includes(url.hostname)) {
    return nativeFetch(new Request(new URL(url.pathname + url.search, providers), request));
  }
  if (url.hostname !== "127.0.0.1") throw new Error(`Unexpected external test request: ${url.hostname}`);
  return nativeFetch(request);
};
Object.defineProperty(Deno, "resolveDns", {
  value: async (hostname: string, type: string) => {
    if (!["devpost.com", "events.example.test"].includes(hostname)) throw new Error("Unexpected external test DNS.");
    return type === "A" ? ["93.184.216.34"] : [];
  },
});
const port = Number(requireEnv("PORT"));
if (requireEnv("CI_EDGE_KIND") === "scraper") {
  const { handleRequest } = await import("../../supabase/functions/scraper/index.ts");
  Deno.serve({ hostname: "127.0.0.1", port }, handleRequest);
} else if (requireEnv("CI_EDGE_KIND") === "etl") {
  const { handleETL } = await import("../../supabase/functions/etl/index.ts");
  Deno.serve({ hostname: "127.0.0.1", port }, handleETL);
} else {
  throw new Error("Unknown test Edge service.");
}
