import { createETLHandler } from "./index.ts";
import { stagingStore } from "../_shared/staging-storage.ts";
import { storageFixture } from "../_shared/storage-test-fixture.ts";

function assert(value: boolean, message: string) { if (!value) throw new Error(message); }

Deno.test("ETL imports Storage records in one-record cursor batches without MongoDB or live AI/database calls", async () => {
  const fixture = storageFixture();
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", "fixture-gateway-secret");
  try {
    const fetchedAt = "2026-11-12T10:00:00.000Z";
    await stagingStore.persist([{ id: 2, fetchedAt, title: "Two" }, { id: 20, fetchedAt, title: "Twenty" }]);
    const imported: unknown[] = [];
    const handler = createETLHandler({ importer: (records, source) => {
      imported.push(...records);
      return Promise.resolve({ source, processed_count: records.length, inserted_count: records.length,
        failed_count: 0, successes: [], failures: [], next_after_id: null });
    } });
    const invoke = (afterId: number | null, path = "storage", extra = {}) => handler(new Request(`https://example.test/functions/v1/etl/etl/import/${path}`, {
      method: "POST",
      headers: { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" },
      body: JSON.stringify({ fetched_at: fetchedAt, cursor_mode: true, limit: 1, after_id: afterId, ...extra }),
    }));
    const first = await (await invoke(null)).json();
    const second = await (await invoke(first.next_after_id)).json();
    const end = await (await invoke(second.next_after_id)).json();
    assert(first.source === "storage" && first.next_after_id === 2 && second.next_after_id === 20, "Storage cursor response changed.");
    assert(end.processed_count === 0 && imported.length === 2, "Import did not terminate exactly once per source.");
    assert((await invoke(null, "mongodb")).status === 200, "Deprecated route alias stopped working.");
    assert((await invoke(null, "mongodb", { database_name: "other" })).status === 400, "Legacy database override was silently ignored.");
    assert((await invoke(null, "storage", { limit: 2 })).status === 400, "AI batch bound was bypassed.");
  } finally {
    fixture.restore();
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET"); else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
