import { stagingStore, verifyStagedCount } from "./staging-storage.ts";
import { StorageError } from "./service-errors.ts";
import { storageFixture } from "./storage-test-fixture.ts";

const run = "2026-11-12T10:00:00.000Z";
const path = (id: number) => `hackscout/raw/${Date.parse(run)}_${String(id).padStart(16, "0")}.json`;
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>, code: string) {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof StorageError && caught.code === code, `Expected ${code}.`);
}

Deno.test("index confirmation follows upload ACK; failures stay pending and retry recovers fixed objects", async () => {
  const fixture = storageFixture();
  try {
    fixture.index.state.failConfirm = true;
    await rejects(() => stagingStore.persist([{ id: 2, fetchedAt: run }]), "STORAGE_MUTATION_UNCONFIRMED");
    assert(fixture.objects.has(path(2)) && fixture.index.pending.has(path(2)), "Uncertainty was not durably reserved.");
    await rejects(() => stagingStore.count(run), "STORAGE_RESPONSE_INVALID");
    await rejects(() => stagingStore.read(run, null, 1), "STORAGE_RESPONSE_INVALID");
    await rejects(() => stagingStore.ids(run), "STORAGE_RESPONSE_INVALID");
    fixture.index.state.failConfirm = false;
    await stagingStore.persist([{ id: 2, fetchedAt: run }]);
    assert(await verifyStagedCount(run) === 1 && fixture.index.pending.size === 0, "Deterministic retry did not confirm its object.");
    fixture.state.badUploadAck = true;
    const confirmations = fixture.index.calls.filter((call) => call.method === "confirm").length;
    await rejects(() => stagingStore.persist([{ id: 3, fetchedAt: run }]), "STORAGE_MUTATION_UNCONFIRMED");
    assert(fixture.index.calls.filter((call) => call.method === "confirm").length === confirmations, "Bad Storage ACK confirmed metadata.");
  } finally { fixture.restore(); }
});

Deno.test("missing schema or incomplete intents never yield a successful empty run", async () => {
  const fixture = storageFixture();
  try {
    fixture.index.state.missing = true;
    for (const action of [() => stagingStore.count(run), () => stagingStore.ids(run),
      () => stagingStore.read(run, null, 1), () => verifyStagedCount(run)]) {
      await rejects(action, "STORAGE_RESPONSE_INVALID");
    }
    fixture.index.state.missing = false;
    fixture.index.state.failPrepare = true;
    await rejects(() => stagingStore.persist([{ id: 1, fetchedAt: run }]), "STORAGE_MUTATION_UNCONFIRMED");
    assert(!fixture.objects.size, "Failed intent reservation wrote an untrackable object.");
  } finally { fixture.restore(); }
});

Deno.test("indexed reads reject missing objects, same-ID content drift, malformed metadata and count mismatches", async () => {
  const fixture = storageFixture();
  try {
    await stagingStore.persist([{ id: 1, fetchedAt: run, title: "Original" }]);
    fixture.objects.delete(path(1));
    await rejects(() => stagingStore.read(run, null, 1), "STORAGE_OBJECT_MISSING");
    await rejects(() => verifyStagedCount(run), "STORAGE_RESPONSE_INVALID");
    fixture.objects.set(path(1), { id: 1, fetchedAt: run, title: "Altered" });
    await rejects(() => stagingStore.read(run, null, 1), "STORAGE_RECORD_INVALID");
    await stagingStore.persist([{ id: 1, fetchedAt: run, title: "Original" }]);
    fixture.index.rows.set(path(1), { ...fixture.index.rows.get(path(1))!, object_name: "wrong.json" });
    await rejects(() => stagingStore.read(run, null, 1), "STORAGE_RESPONSE_INVALID");
    await stagingStore.persist([{ id: 1, fetchedAt: run }]);
    fixture.objects.set(path(2), { id: 2, fetchedAt: run });
    fixture.index.rows.delete(path(2));
    await rejects(() => verifyStagedCount(run), "STORAGE_RESPONSE_INVALID");
  } finally { fixture.restore(); }
});

Deno.test("reset retains rows after bad deletion ACK or index cleanup failure and heals confirmed physical absence", async () => {
  const fixture = storageFixture();
  try {
    await stagingStore.persist([{ id: 1, fetchedAt: run }]);
    fixture.state.badDeleteAck = true;
    fixture.state.deleteKeepOne = true;
    await rejects(() => stagingStore.reset(), "STORAGE_MUTATION_UNCONFIRMED");
    assert(fixture.index.rows.has(path(1)) && !fixture.index.calls.some((call) => call.method === "remove"), "Unconfirmed deletion removed metadata.");
    fixture.state.badDeleteAck = false;
    fixture.state.deleteKeepOne = false;
    fixture.index.state.failRemove = true;
    await rejects(() => stagingStore.reset(), "STORAGE_MUTATION_UNCONFIRMED");
    assert(fixture.index.rows.has(path(1)), "Failed index cleanup looked confirmed.");
    fixture.index.state.failRemove = false;
    const reset = await stagingStore.reset();
    assert(!reset.hasMore && !fixture.index.rows.size, "Verified physical absence did not heal orphan index rows.");
    await stagingStore.persist([{ id: 1, fetchedAt: run }]);
    await stagingStore.reset();
    assert(!fixture.index.rows.size, "Exact deletion ACK retained deleted metadata.");
  } finally { fixture.restore(); }
});

Deno.test("reset reconciles ambiguous deletion only when every exact planned path is physically absent", async () => {
  const fixture = storageFixture();
  try {
    for (let id = 0; id < 205; id++) fixture.objects.set(path(id), { id, fetchedAt: run });
    fixture.state.badDeleteAck = true;
    const result = await stagingStore.reset();
    assert(result.deletedRecords === 100 && result.hasMore, "Reconciliation guessed counts or completion.");
    assert(fixture.index.rows.size === 105, "Confirmed absence did not remove exactly the planned metadata.");
    assert(fixture.calls.filter((call) => call.method === "DELETE").length === 1, "Ambiguous delete was retried.");
    assert(fixture.calls.filter((call) => call.path.startsWith("object/list/")).length === 2, "Reconciliation did not refresh actual Storage.");
    fixture.state.deleteKeepOne = true;
    await rejects(() => stagingStore.reset(), "STORAGE_MUTATION_UNCONFIRMED");
    assert(fixture.index.rows.size === 105, "Partial physical deletion removed planned metadata.");
  } finally { fixture.restore(); }
});

Deno.test("unique run cap is reserved before Storage mutation and duplicate updates remain possible", async () => {
  const fixture = storageFixture();
  try {
    for (let id = 0; id < 9998; id++) fixture.objects.set(path(id), { id, fetchedAt: run });
    await rejects(() => stagingStore.persist([{ id: 9998, fetchedAt: run }]), "STORAGE_LIMIT_EXCEEDED");
    assert(!fixture.objects.has(path(9998)), "Cap violation uploaded an extra raw object.");
    await stagingStore.persist([{ id: 9997, fetchedAt: run, title: "Updated" }]);
    assert((await stagingStore.read(run, 9996, 1))[0].title === "Updated", "Cap blocked an existing ID overwrite.");
  } finally { fixture.restore(); }
});
