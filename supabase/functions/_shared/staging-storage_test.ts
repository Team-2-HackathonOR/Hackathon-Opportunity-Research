import { stagingStore } from "./staging-storage.ts";
import { StorageError, storageFailure } from "./service-errors.ts";
import { storageFixture } from "./storage-test-fixture.ts";

function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const first = "2026-11-12T10:00:00.000Z";
const second = "2026-11-12T11:00:00.000Z";
async function rejects(action: () => Promise<unknown>, code: string) {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof StorageError && caught.code === code, `Expected ${code}.`);
}

Deno.test("Storage persists deduplicated JSON, isolates runs and preserves numeric ETL cursors", async () => {
  const fixture = storageFixture();
  try {
    await stagingStore.persist([{ id: 20, fetchedAt: first, title: "Twenty" },
      { id: 2, fetchedAt: first, title: "Old" }, { id: 2, fetchedAt: first, title: "Two" }]);
    await stagingStore.persist([{ id: 2, fetchedAt: second, title: "Latest" }]);
    assert(await stagingStore.count(first) === 2 && await stagingStore.count(second) === 1, "Run count included duplicates or another run.");
    const one = await stagingStore.read(first, null, 1);
    const two = await stagingStore.read(first, one[0].id, 1);
    assert(one[0].id === 2 && one[0].title === "Two" && two[0].id === 20, "Cursor ordering or overwrite changed.");
    assert((await stagingStore.read(first, 20, 1)).length === 0, "End of cursor did not terminate.");
    assert((await stagingStore.read(null, null, 10))[0].title === "Latest", "Cache did not select the newest version.");
    assert(!JSON.stringify([...fixture.objects.values()]).includes("fixture-private-service-key"), "Credential was stored in an object.");
  } finally { fixture.restore(); }
});

Deno.test("Storage cleanup deletes only owned record objects and checks exact deletion acknowledgements", async () => {
  const fixture = storageFixture();
  try {
    await stagingStore.persist([{ id: 1, fetchedAt: first }]);
    fixture.objects.set("other-prefix/keep.json", { keep: true });
    fixture.objects.set("hackscout/raw/notes.json", { keep: true });
    fixture.objects.set("hackscout/raw/subfolder/keep.json", { keep: true });
    assert(await stagingStore.reset() === 1, "Wrong reset count.");
    assert(fixture.objects.size === 3, "Cleanup deleted unrelated files or folders.");
    await stagingStore.persist([{ id: 1, fetchedAt: first }]);
    fixture.state.badDeleteAck = true;
    await rejects(() => stagingStore.reset(), "STORAGE_MUTATION_UNCONFIRMED");
  } finally { fixture.restore(); }
});

Deno.test("Storage refuses public buckets, bad configuration and unacknowledged writes without hiding failures", async () => {
  const fixture = storageFixture();
  try {
    fixture.state.public = true;
    await rejects(() => stagingStore.persist([{ id: 1, fetchedAt: first }]), "STORAGE_BUCKET_PUBLIC");
    assert(!fixture.calls.some((call) => call.path.startsWith("object/")), "Public bucket received a data request.");
    fixture.state.public = false;
    for (const prefix of ["../", "", "/"]) {
      Deno.env.set("STAGING_STORAGE_PREFIX", prefix);
      await rejects(() => stagingStore.reset(), "STORAGE_CONFIG_INVALID");
    }
    Deno.env.set("STAGING_STORAGE_PREFIX", "hackscout/raw");
    await rejects(() => stagingStore.persist([{ id: -1, fetchedAt: first }]), "STORAGE_RECORD_INVALID");
    fixture.state.badUploadAck = true;
    await rejects(() => stagingStore.persist([{ id: 1, fetchedAt: first }]), "STORAGE_MUTATION_UNCONFIRMED");
    for (const [status, code] of [[401, "STORAGE_AUTH_FAILED"], [403, "STORAGE_PERMISSION_DENIED"], [404, "STORAGE_BUCKET_MISSING"]] as const) {
      fixture.state.failureStatus = status;
      await rejects(() => stagingStore.count(first), code);
    }
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    await rejects(() => stagingStore.count(first), "STORAGE_CONFIG_MISSING");
    const response = storageFailure(new Error("fixture-private-service-key"));
    assert(!JSON.stringify(response).includes("fixture-private-service-key"), "Error exposed a credential.");
  } finally { fixture.restore(); }
});

Deno.test("Storage listing paginates without silently truncating records", async () => {
  const fixture = storageFixture();
  try {
    const run = Date.parse(first);
    for (let id = 0; id < 1001; id++) fixture.objects.set(`hackscout/raw/${run}_${String(id).padStart(16, "0")}.json`, { id, fetchedAt: first });
    assert(await stagingStore.count(first) === 1001, "Only the first listing page was counted.");
    assert((await stagingStore.read(first, 999, 1))[0].id === 1000, "Cursor failed across the listing boundary.");
  } finally { fixture.restore(); }
});
