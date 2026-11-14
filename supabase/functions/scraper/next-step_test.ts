import { handleRequest } from "./index.ts";

const headers = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };
const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
Deno.test("advancing stages requires a verified administrator, POST, confirmation and a replacement key", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", headers["x-gateway-secret"]);
  try {
    const url = "https://fixture.test/functions/v1/scraper/pipeline/next-step";
    const direct = await handleRequest(new Request(url, { method: "POST", headers: { "x-user-role": "admin" }, body: "{}" }));
    assert(direct.status === 403, "Direct callers cannot advance stages.");
    for (const role of ["viewer", null]) {
      const response = await handleRequest(new Request(url, {
        method: "POST", headers: role ? { ...headers, "x-user-role": role } : headers, body: "{}",
      }));
      assert(response.status === 403, "Only verified administrators can advance stages.");
    }
    const admin = { ...headers, "x-user-role": "admin" };
    const get = await handleRequest(new Request(url, { headers: admin }));
    assert(get.status === 405, "GET must never enqueue ETL.");
    for (const payload of [{}, { jobId: "invalid", apiKey: "fixture", confirmation: "ADVANCE TO ETL" },
      { jobId: "11111111-1111-4111-8111-111111111111", apiKey: "", confirmation: "ADVANCE TO ETL" }]) {
      const response = await handleRequest(new Request(url, { method: "POST", headers: admin, body: JSON.stringify(payload) }));
      assert(response.status === 400, "Invalid advancement must fail before database or Storage access.");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
