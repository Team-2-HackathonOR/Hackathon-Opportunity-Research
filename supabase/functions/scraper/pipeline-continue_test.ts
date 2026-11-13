import { handleRequest } from "./index.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
const url = "https://example.test/functions/v1/scraper/pipeline/continue";
const gateway = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };

Deno.test("Continue requires both the gateway credential and an administrator before reading a key or accessing data", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", gateway["x-gateway-secret"]);
  try {
    for (const headers of [{}, gateway, { ...gateway, "x-user-role": "viewer" }]) {
      const response = await handleRequest(new Request(url, { method: "POST", headers, body: "invalid json" }));
      assert(response.status === 403, "Continue was exposed to a non-administrator.");
    }
    for (const payload of [
      {}, { jobId: "invalid", apiKey: "fixture" },
      { jobId: "11111111-1111-4111-8111-111111111111" },
      { jobId: "11111111-1111-4111-8111-111111111111", apiKey: " " },
    ]) {
      const response = await handleRequest(new Request(url, {
        method: "POST", headers: { ...gateway, "x-user-role": "admin" }, body: JSON.stringify(payload),
      }));
      assert(response.status === 400, "Invalid Continue input reached the database.");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
