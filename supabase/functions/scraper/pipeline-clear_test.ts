import { handleRequest } from "./index.ts";

const gateway = { "x-gateway-secret": "fixture-gateway-secret", "x-gateway-caller": "team-2-gateway" };
const url = "https://example.test/functions/v1/scraper/pipeline/clear";

Deno.test("Clear all requires administrator and gateway authorization, explicit confirmation and a valid current job target", async () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", gateway["x-gateway-secret"]);
  try {
    for (const headers of [{}, gateway, { ...gateway, "x-user-role": "viewer" }]) {
      const response = await handleRequest(new Request(url, { method: "POST", headers, body: "invalid json" }));
      if (response.status !== 403) throw new Error("Non-administrator reached destructive Clear all.");
    }
    const headers = { ...gateway, "x-user-role": "admin" };
    for (const body of [null, {}, { jobId: null }, { confirmation: "CLEAR ALL" },
      { jobId: "invalid", confirmation: "CLEAR ALL" }, { jobId: null, confirmation: true }]) {
      const response = await handleRequest(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
      if (response.status !== 400) throw new Error("Invalid Clear all request reached the database.");
    }
    if ((await handleRequest(new Request(url, { headers }))).status !== 405) throw new Error("Clear all allowed a non-POST method.");
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
