import { beforeEach, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../supabase/functions/_shared/runtime.ts", () => ({
  db: () => controls.query,
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  json: (value: unknown, status = 200) => Response.json(value, { status }),
}));
vi.mock("../../supabase/functions/_shared/staging-storage.ts", () => ({ stagingStore: {} }));
const handleDeadLetters = async (request: Request, path: string) => {
  const api = await vi.importActual<{ handleDeadLetters(request: Request, path: string): Promise<Response> }>(
    "../../supabase/functions/_shared/pipeline-dead-letters.ts");
  return api.handleDeadLetters(request, path);
};

beforeEach(() => { vi.resetAllMocks(); });
it("returns at most 20 metadata summaries with a stable descending cursor and separate pending count", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: String(31 - index), job_id: "fixture-run", operation_name: `etl-${500 - index}`,
    source_record_id: String(501 - index), reason: "Schema validation failed.",
  }));
  controls.query.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ total: 49 }]);
  const response = await handleDeadLetters(new Request("https://fixture.test/pipeline/dead-letters?beforeId=40"), "/pipeline/dead-letters");
  expect(await response.json()).toEqual({ items: rows.slice(0, 20), total: 49, nextBeforeId: "12" });
  const call = controls.query.mock.calls[0];
  if (!call) throw new Error("Expected a dead-letter listing query.");
  const [strings, ...values] = call;
  expect(strings.join("")).toMatch(/status='pending'.*ORDER BY id DESC LIMIT 21/s);
  expect(strings.join("")).not.toContain("raw_record");
  expect(values).toEqual(["40", "40"]);
});

it("returns original source only in record detail and reports missing records explicitly", async () => {
  const item = { id: "9", status: "pending", raw_record: { id: 402, nested: { original: true } } };
  controls.query.mockResolvedValueOnce([item]);
  const response = await handleDeadLetters(new Request("https://fixture.test/pipeline/dead-letters/9"), "/pipeline/dead-letters/9");
  expect(await response.json()).toEqual({ item });
  expect(controls.query.mock.calls[0]?.[0].join("")).toContain("raw_record");
  controls.query.mockResolvedValueOnce([]);
  await expect(handleDeadLetters(new Request("https://fixture.test/pipeline/dead-letters/9"), "/pipeline/dead-letters/9"))
    .rejects.toMatchObject({ status: 404 });
});

it("rejects malformed and overflowing cursors, repeated pagination, and mutations before touching the database", async () => {
  for (const query of ["beforeId=0", "beforeId=-1", "beforeId=9223372036854775808", "beforeId=1&beforeId=2"]) {
    await expect(handleDeadLetters(new Request(`https://fixture.test/pipeline/dead-letters?${query}`), "/pipeline/dead-letters"))
      .rejects.toMatchObject({ status: 400 });
  }
  await expect(handleDeadLetters(new Request("https://fixture.test/pipeline/dead-letters", { method: "POST" }), "/pipeline/dead-letters"))
    .rejects.toMatchObject({ status: 405 });
  expect(controls.query).not.toHaveBeenCalled();
});
