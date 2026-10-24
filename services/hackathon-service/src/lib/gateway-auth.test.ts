import { describe, expect, it } from "vitest";

import { authorizeServiceRequest } from "./gateway-auth.js";

const secret = "test-gateway-secret-value";

describe("authorizeServiceRequest", () => {
  it("leaves health routes open", () => {
    expect(authorizeServiceRequest("/health", {}, undefined)).toBeNull();
    expect(authorizeServiceRequest("/health/ready?db=1", {}, secret)).toBeNull();
  });

  it("rejects API calls when the gateway secret is not configured", () => {
    expect(authorizeServiceRequest("/api/hackathons", {}, undefined)).toEqual({
      status: 503,
      body: {
        error: "Gateway secret is not configured.",
        env: "GATEWAY_INTERNAL_SECRET",
      },
    });
  });

  it("rejects calls that did not come from the gateway", () => {
    expect(
      authorizeServiceRequest("/api/hackathons", { "x-gateway-secret": secret }, secret),
    ).toMatchObject({ status: 403 });
  });

  it("rejects a wrong gateway secret", () => {
    expect(
      authorizeServiceRequest(
        "/api/hackathons",
        { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": "wrong-secret-value" },
        secret,
      ),
    ).toMatchObject({ status: 403 });
  });

  it("accepts a gateway call with the shared secret", () => {
    expect(
      authorizeServiceRequest(
        "/api/hackathons?limit=1",
        { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": secret },
        secret,
      ),
    ).toBeNull();
  });
});
