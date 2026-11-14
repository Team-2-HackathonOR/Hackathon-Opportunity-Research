import { afterEach, beforeEach, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  expireJobs: vi.fn(), claimJob: vi.fn(), publishJob: vi.fn(), rowKey: vi.fn(),
  operation: vi.fn(), query: vi.fn(), read: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/pipeline.ts", () => ({
  ...controls, cancelJob: vi.fn(), createJob: vi.fn(), latestJob: vi.fn(),
  nextOccurrence: vi.fn(), scheduleView: vi.fn(),
  failedJob: (job: object, error: string) => ({ ...job, status: "failed", error }),
}));
vi.mock("../../supabase/functions/_shared/runtime.ts", () => ({
  db: () => Object.assign(controls.query, { json: (value: unknown) => value }),
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  diagnosticError: (error: Error) => ({ message: error.message }),
  env: () => "https://fixture-gateway.test", readJson: (request: Request) => request.json(),
}));
vi.mock("../../supabase/functions/_shared/staging-storage.ts", () => ({ stagingStore: { read: controls.read } }));
vi.mock("../../supabase/functions/scraper/service.ts", () => ({ handleScraper: vi.fn() }));
vi.mock("../../supabase/functions/_shared/pipeline-resume.ts", () => ({ resumeJob: vi.fn() }));

const raw = { id: 402, fetchedAt: "2026-11-13T00:00:00.000Z", title: "Original source", dates: "unparseable" };
const failure = {
  processed_count: 1, inserted_count: 0, failed_count: 1, next_after_id: 402,
  failures: [{ record_index: 0, source_identifier: "402", reason: "Record does not satisfy the event schema.", raw_record: raw }],
};
const row = () => ({
  id: "11111111-1111-4111-8111-111111111111", execution_id: "22222222-2222-4222-8222-222222222222",
  job: {
    id: "11111111-1111-4111-8111-111111111111", status: "queued", stage: "etl",
    stagingBackend: "supabase-storage", startedAt: raw.fetchedAt, reset: {},
    scraper: { pagesPersisted: 10, uniqueHackathonsPersisted: 2 },
    steps: { reset: { status: "completed" }, scraper: { status: "completed" }, etl: { status: "waiting" } },
    cursor: { phase: "etl", page: 10, afterId: 401 },
    etl: { processed: 0, inserted: 0, failed: 0 },
  },
});
const tick = async () => {
  const worker = await vi.importActual<{ tick(request: Request): Promise<Response> }>("../../supabase/functions/scraper/pipeline.ts");
  return worker.tick(new Request("https://fixture.test/pipeline/tick", { method: "POST" }));
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(failure)));
  vi.spyOn(console, "error").mockImplementation(() => {});
  controls.rowKey.mockReturnValue("fixture-not-for-queue");
  controls.query.mockResolvedValue([{ id: "9" }]);
  controls.read.mockResolvedValue([raw]);
  controls.claimJob.mockResolvedValue(row());
  controls.operation.mockImplementation(async (_row, _name, run, validate) => {
    const result = await run();
    if (!validate(result)) throw new Error("Invalid acknowledgement.");
    return result;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("durably archives a confirmed failure before advancing, then imports the next record and completes with a warning count", async () => {
  await tick();
  const saved = controls.publishJob.mock.calls[0]?.[1];
  expect(saved).toMatchObject({
    status: "running", cursor: { afterId: 402 }, etl: { processed: 1, inserted: 0, failed: 1, deadLettered: 1 },
  });
  expect(controls.query.mock.calls[0]?.[0].join("")).toContain("archive_edge_dead_letter");
  expect(controls.query.mock.calls[0]?.slice(1)).toContain(JSON.stringify(raw));
  expect(JSON.stringify(controls.query.mock.calls)).not.toContain("fixture-not-for-queue");
  const archiveOrder = controls.query.mock.invocationCallOrder[0], publishOrder = controls.publishJob.mock.invocationCallOrder[0];
  if (archiveOrder === undefined || publishOrder === undefined) throw new Error("Archive and publication must both occur.");
  expect(archiveOrder).toBeLessThan(publishOrder);
  expect(controls.read).not.toHaveBeenCalled();
  controls.claimJob.mockResolvedValue({ ...row(), job: structuredClone(saved) });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    processed_count: 1, inserted_count: 1, failed_count: 0, next_after_id: 403,
  }));
  await tick();
  const imported = controls.publishJob.mock.calls[1]?.[1];
  controls.claimJob.mockResolvedValue({ ...row(), job: structuredClone(imported) });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    processed_count: 0, inserted_count: 0, failed_count: 0, next_after_id: null,
  }));
  await tick();
  expect(controls.publishJob.mock.calls[2]?.[1]).toMatchObject({
    status: "completed", etl: { processed: 2, inserted: 1, failed: 1, deadLettered: 1 },
  });
  expect(controls.query).toHaveBeenCalledTimes(1);
});

it("a queue write failure preserves the cursor and totals; a completed acknowledgement replays without another import", async () => {
  const checkpoint = row();
  controls.query.mockRejectedValueOnce(new Error("Queue persistence unavailable."));
  await tick();
  expect(controls.publishJob.mock.calls[0]?.[1]).toMatchObject({
    status: "failed", cursor: { afterId: 401 }, etl: { processed: 0, inserted: 0, failed: 0 },
  });
  controls.claimJob.mockResolvedValue(checkpoint);
  controls.operation.mockResolvedValueOnce(failure);
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(controls.publishJob.mock.calls[1]?.[1]).toMatchObject({
    cursor: { afterId: 402 }, etl: { processed: 1, inserted: 0, failed: 1, deadLettered: 1 },
  });
});

it("lost checkpoint publication reuses the archived failure and never repeats the upstream import", async () => {
  const checkpoint = structuredClone(row());
  controls.publishJob.mockRejectedValueOnce(new Error("Checkpoint publication unavailable."));
  await tick();
  controls.claimJob.mockResolvedValue(checkpoint);
  controls.operation.mockResolvedValueOnce(failure);
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(controls.query).toHaveBeenCalledTimes(2);
  expect(controls.publishJob.mock.calls.at(-1)?.[1]).toMatchObject({
    cursor: { afterId: 402 }, etl: { processed: 1, failed: 1, deadLettered: 1 },
  });
});

it("legacy confirmed failures recover the exact original staged record without redoing AI", async () => {
  const legacy = { ...failure, failures: failure.failures.map(({ raw_record: _raw, ...details }) => details) };
  controls.operation.mockResolvedValueOnce(legacy);
  await tick();
  expect(fetch).not.toHaveBeenCalled();
  expect(controls.read).toHaveBeenCalledWith(raw.fetchedAt, 401, 1);
  expect(controls.publishJob.mock.calls[0]?.[1].cursor.afterId).toBe(402);
  controls.claimJob.mockResolvedValue(row());
  controls.operation.mockResolvedValueOnce(legacy);
  controls.read.mockResolvedValueOnce([{ ...raw, id: 403 }]);
  await tick();
  expect(controls.publishJob.mock.calls[1]?.[1]).toMatchObject({ status: "failed", cursor: { afterId: 401 } });
  expect(controls.query).toHaveBeenCalledTimes(1);
});

it("unknown operations and service failures still pause without advancing or manufacturing dead letters", async () => {
  controls.operation.mockRejectedValueOnce(new Error("Operation has no confirmed outcome."));
  await tick();
  expect(controls.query).not.toHaveBeenCalled();
  expect(controls.publishJob.mock.calls[0]?.[1]).toMatchObject({ status: "failed", cursor: { afterId: 401 } });
  controls.claimJob.mockResolvedValue(row());
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ detail: "Unavailable." }, { status: 503 }));
  await tick();
  expect(controls.query).not.toHaveBeenCalled();
  expect(controls.publishJob.mock.calls[1]?.[1]).toMatchObject({ status: "failed", cursor: { afterId: 401 } });
});
