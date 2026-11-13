import { afterEach, beforeEach, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  expireJobs: vi.fn(), claimJob: vi.fn(), publishJob: vi.fn(), rowKey: vi.fn(),
  operation: vi.fn(), handleScraper: vi.fn(), query: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/pipeline.ts", () => ({
  ...controls, cancelJob: vi.fn(), createJob: vi.fn(), latestJob: vi.fn(),
  nextOccurrence: vi.fn(), scheduleView: vi.fn(),
  failedJob: (job: object, message: string) => ({ ...job, status: "failed", error: message }),
}));
vi.mock("../../supabase/functions/_shared/runtime.ts", () => ({
  db: () => Object.assign(controls.query, { begin: (run: (query: typeof controls.query) => unknown) => run(controls.query) }),
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  diagnosticError: () => undefined, env: () => "fixture-gateway-secret",
  readJson: (request: Request) => request.json(),
}));
vi.mock("../../supabase/functions/scraper/service.ts", () => ({ handleScraper: controls.handleScraper }));
vi.mock("../../supabase/functions/_shared/pipeline-resume.ts", () => ({ resumeJob: vi.fn() }));

const tick = async () => {
  const worker = await vi.importActual<{ tick(request: Request): Promise<Response> }>("../../supabase/functions/scraper/pipeline.ts");
  return worker.tick(new Request("https://example.test/functions/v1/scraper/pipeline/tick", { method: "POST" }));
};
const row = (phase: string, clearing = true) => ({
  id: "11111111-1111-4111-8111-111111111111", execution_id: "22222222-2222-4222-8222-222222222222",
  key_ciphertext: null, job: {
    id: "11111111-1111-4111-8111-111111111111", status: "queued", stage: "reset",
    purpose: clearing ? "clear" : undefined, stagingBackend: "supabase-storage",
    startedAt: "2026-11-13T00:00:00.000Z", reset: {},
    cursor: { phase, page: 1, afterId: null },
    steps: { reset: { status: "waiting" }, scraper: { status: "skipped" }, etl: { status: "skipped" } },
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Clear all must not call AI or ETL."); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  controls.rowKey.mockReturnValue("fixture-ai-key");
  controls.query.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("").includes("DELETE FROM hackathon_research.events") ? { count: 3 } : [{ cleared: true }]);
  controls.operation.mockImplementation(async (_row, _name, run, validate) => {
    const result = await run();
    if (!validate(result)) throw new Error("Invalid acknowledgement.");
    return result;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("Clear all deletes a bounded Storage batch without an AI key and checkpoints the remaining cleanup", async () => {
  controls.claimJob.mockResolvedValue(row("reset-storage"));
  controls.handleScraper.mockResolvedValue(Response.json({ reset: false, deletedRecords: 100, hasMore: true }));
  expect((await tick()).status).toBe(200);
  expect(controls.rowKey).not.toHaveBeenCalled();
  expect(controls.handleScraper).toHaveBeenCalledTimes(1);
  expect(controls.handleScraper).toHaveBeenCalledWith(expect.any(Request), "/hackathons/reset");
  expect(controls.publishJob).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ cursor: expect.objectContaining({ phase: "reset-storage", resetBatch: 2 }) }));
  expect(fetch).not.toHaveBeenCalled();
});

it("Clear all finishes PostgreSQL cleanup and removes history without publishing a scraper or ETL phase", async () => {
  controls.claimJob.mockResolvedValue(row("reset-postgresql"));
  const response = await tick();
  expect(await response.json()).toEqual({ ok: true, active: false, cleared: true });
  expect(controls.query.mock.calls.some(([strings]) => strings.join("").includes("finish_edge_clear"))).toBe(true);
  expect(controls.rowKey).not.toHaveBeenCalled();
  expect(controls.publishJob).not.toHaveBeenCalled();
  expect(controls.handleScraper).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("normal pipeline cleanup still advances to scraping and retains its key requirement", async () => {
  controls.claimJob.mockResolvedValue(row("reset-postgresql", false));
  await tick();
  expect(controls.rowKey).toHaveBeenCalledTimes(1);
  expect(controls.publishJob).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ cursor: expect.objectContaining({ phase: "scraper" }) }));
  expect(controls.query.mock.calls.some(([strings]) => strings.join("").includes("finish_edge_clear"))).toBe(false);
});

it("an invalid Clear-only checkpoint fails explicitly instead of starting ETL", async () => {
  controls.claimJob.mockResolvedValue(row("etl"));
  await tick();
  expect(controls.publishJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed" }));
  expect(controls.operation).not.toHaveBeenCalled();
  expect(controls.rowKey).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
