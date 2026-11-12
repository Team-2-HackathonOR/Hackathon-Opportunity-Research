import { authorize, HttpError } from "./runtime.ts";

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

Deno.test("all direct callers are denied, including spoofed gateway names and browser tokens", () => {
  const previous = Deno.env.get("GATEWAY_INTERNAL_SECRET");
  Deno.env.set("GATEWAY_INTERNAL_SECRET", "fixture-gateway-secret");
  try {
    const cases: Record<string, string>[] = [
      {},
      { "x-gateway-caller": "team-2-gateway" },
      { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "incorrect" },
      { "x-gateway-secret": "fixture-gateway-secret" },
      { authorization: "Bearer public-browser-token" },
    ];
    for (const headers of cases) {
      let denied = false;
      try { authorize(new Request("https://example.test/functions/v1/scraper", { headers })); }
      catch (error) { denied = error instanceof HttpError && error.status === 403; }
      assert(denied, "Direct caller was not denied.");
    }
    authorize(new Request("https://example.test/functions/v1/etl", {
      headers: { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "fixture-gateway-secret" },
    }));
    Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    let failedClosed = false;
    try { authorize(new Request("https://example.test")); }
    catch (error) { failedClosed = error instanceof HttpError && error.status === 503; }
    assert(failedClosed, "Missing configuration must fail closed.");
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_INTERNAL_SECRET");
    else Deno.env.set("GATEWAY_INTERNAL_SECRET", previous);
  }
});
