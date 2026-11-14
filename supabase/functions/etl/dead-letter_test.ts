import { createETLHandler } from "./index.ts";
import { handleRequest } from "../scraper/index.ts";
import type { StagingStore } from "../_shared/staging-storage.ts";

const headers = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };
const raw = { id: 402, fetchedAt: "2026-11-13T00:00:00.000Z", title: "Original raw source" };
const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
const store: StagingStore = {
  read: () => Promise.resolve([raw]), count: () => Promise.resolve(1), ids: () => Promise.resolve(new Set([402])),
  persist: () => Promise.reject(new Error("No staging writes expected.")),
  reset: () => Promise.reject(new Error("No reset expected.")),
};

Deno.test("only cursor-mode failed acknowledgements include the original source, never the AI key", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", headers["x-gateway-secret"]);
  const handler = createETLHandler({ store, importer: () => Promise.resolve({
    source: "storage", processed_count: 1, inserted_count: 0, failed_count: 1, successes: [],
    failures: [{ record_index: 0, source_identifier: "402", reason: "Record does not satisfy the event schema." }],
    next_after_id: null,
  }) });
  try {
    for (const cursor_mode of [true, false]) {
      const response = await handler(new Request("https://fixture.test/etl/import/storage", {
        method: "POST", headers: { ...headers, "x-ai-api-key": "fixture-never-persist-key" },
        body: JSON.stringify({ fetched_at: raw.fetchedAt, limit: 1, cursor_mode, use_ai_normalization: false }),
      }));
      const text = await response.text();
      const result = JSON.parse(text);
      assert(response.status === 200, "Confirmed failure should have an acknowledgement.");
      assert(!text.includes("fixture-never-persist-key"), "Credentials entered the failure payload.");
      assert(cursor_mode ? JSON.stringify(result.failures[0].raw_record) === JSON.stringify(raw)
        : result.failures[0].raw_record === undefined, "Original source must be confined to internal cursor acknowledgements.");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});

Deno.test("provider authentication and rate-limit failures pause the request instead of dead-lettering every record", async () => {
  const previousSecret = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  const previousFetch = globalThis.fetch;
  Deno.env.set("GATEWAY_INTERNAL_SECRET", headers["x-gateway-secret"]);
  try {
    for (const status of [401, 429, 500]) {
      globalThis.fetch = () => Promise.resolve(new Response(null, { status }));
      const response = await createETLHandler({ store })(new Request("https://fixture.test/etl/import/storage", {
        method: "POST", headers: { ...headers, "x-ai-api-key": "fixture-never-persist-key" },
        body: JSON.stringify({ fetched_at: raw.fetchedAt, limit: 1, cursor_mode: true, use_ai_normalization: true }),
      }));
      const text = await response.text();
      assert(response.status === 503, `Provider HTTP ${status} must pause the service request.`);
      assert(!text.includes("raw_record") && !text.includes("fixture-never-persist-key"), "A service failure leaked source or credentials.");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previousSecret);
  }
});

Deno.test("dead-letter list and detail require a verified administrator even through the internal gateway", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", headers["x-gateway-secret"]);
  try {
    for (const path of ["/pipeline/dead-letters", "/pipeline/dead-letters/9"]) {
      for (const role of [null, "viewer", "admin"]) {
        const supplied = role ? { ...headers, "x-user-role": role } : headers;
        const direct = await handleRequest(new Request(`https://fixture.test/functions/v1/scraper${path}`, {
          headers: { "x-user-role": "admin" },
        }));
        assert(direct.status === 403, "Direct source access must be denied.");
        if (role === "admin") continue;
        const response = await handleRequest(new Request(`https://fixture.test/functions/v1/scraper${path}`, { headers: supplied }));
        assert(response.status === 403, "Only a verified administrator can read dead letters.");
      }
    }
    const response = await handleRequest(new Request("https://fixture.test/functions/v1/scraper/pipeline/dead-letters?beforeId=invalid", {
      headers: { ...headers, "x-user-role": "admin" },
    }));
    assert(response.status === 400, "Invalid pagination must fail before database access.");
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
