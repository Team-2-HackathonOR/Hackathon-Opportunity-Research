import { beforeEach, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ query: vi.fn(), latest: vi.fn(), count: vi.fn(), encrypt: vi.fn() }));
vi.mock("../../supabase/functions/_shared/runtime.ts", () => ({
  db: () => controls.query, readJson: (request: Request) => request.json(),
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  json: (value: unknown, status = 200) => Response.json(value, { status }),
}));
vi.mock("../../supabase/functions/_shared/pipeline.ts", () => ({ latestJob: controls.latest }));
vi.mock("../../supabase/functions/_shared/pipeline-keys.ts", () => ({ encryptKey: controls.encrypt }));
vi.mock("../../supabase/functions/_shared/staging-storage.ts", () => ({ verifyStagedCount: controls.count }));
const id = "11111111-1111-4111-8111-111111111111";
const stopped = {
  id, status: "failed", cancelled: true, stagingBackend: "supabase-storage",
  startedAt: "2026-11-13T00:00:00.000Z", cursor: { phase: "scraper", page: 2, afterId: null },
};
const invoke = async (body: unknown) => {
  const api = await vi.importActual<{ handleNextStep(request: Request): Promise<Response> }>(
    "../../supabase/functions/_shared/pipeline-next-step.ts");
  return api.handleNextStep(new Request("https://fixture.test/pipeline/next-step", {
    method: "POST", body: JSON.stringify(body),
  }));
};
const payload = { jobId: id, apiKey: " fixture-plaintext ", confirmation: "ADVANCE TO ETL" };
beforeEach(() => {
  vi.resetAllMocks();
  controls.latest.mockResolvedValue(stopped);
  controls.count.mockResolvedValue(9);
  controls.encrypt.mockReturnValue("encrypted-fixture");
  controls.query.mockResolvedValue([{ job: { ...stopped, status: "queued", cursor: { phase: "etl" } } }]);
});

it("verifies the original staged count and queues the same job with a job-bound encrypted replacement key", async () => {
  const response = await invoke(payload);
  expect(response.status).toBe(202);
  expect((await response.json()).job).toMatchObject({ id, status: "queued", cursor: { phase: "etl" } });
  expect(controls.count).toHaveBeenCalledWith(stopped.startedAt);
  expect(controls.encrypt).toHaveBeenCalledWith("fixture-plaintext", id);
  const call = controls.query.mock.calls[0];
  if (!call) throw new Error("Expected a stage-advance query.");
  expect(call.slice(1)).toEqual([id, "encrypted-fixture", stopped.startedAt, 9]);
  expect(call[0].join("")).toContain("advance_edge_job_to_etl");
  expect(JSON.stringify(controls.query.mock.calls)).not.toContain("fixture-plaintext");
});

it("requires confirmation, a valid stopped latest run and a fresh key before counting data or mutating state", async () => {
  for (const body of [[], { ...payload, confirmation: "" }, { ...payload, apiKey: "" }, { ...payload, jobId: "invalid" }]) {
    await expect(invoke(body)).rejects.toMatchObject({ status: 400 });
  }
  expect(controls.latest).not.toHaveBeenCalled();
  controls.latest.mockResolvedValueOnce({ ...stopped, cancelled: false });
  await expect(invoke(payload)).rejects.toMatchObject({ status: 409 });
  expect(controls.count).not.toHaveBeenCalled();
  expect(controls.query).not.toHaveBeenCalled();
});

it("storage failures, unknown-operation refusals and unconfirmed enqueue outcomes never report success", async () => {
  controls.count.mockRejectedValueOnce(new Error("Storage unavailable."));
  await expect(invoke(payload)).rejects.toThrow("Storage unavailable.");
  expect(controls.query).not.toHaveBeenCalled();
  controls.query.mockRejectedValueOnce(Object.assign(new Error("Operation has no confirmed outcome."), { code: "P0001" }));
  await expect(invoke(payload)).rejects.toMatchObject({ status: 409, message: "Operation has no confirmed outcome." });
  controls.query.mockResolvedValueOnce([]);
  await expect(invoke(payload)).rejects.toMatchObject({ status: 503 });
});
