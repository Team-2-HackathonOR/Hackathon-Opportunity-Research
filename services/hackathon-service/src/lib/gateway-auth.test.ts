import { describe, expect, it } from "vitest";

import { authorizeServiceRequest } from "./gateway-auth.js";

const secret = "test-gateway-secret-value";

const gatewayIdentity = {
  "x-gateway-caller": "team-2-gateway",
  "x-gateway-secret": secret,
  "x-user-id": "11111111-1111-1111-1111-111111111111",
  "x-user-role": "viewer",
};

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

  it("rejects a gateway call that is missing user identity headers", () => {
    expect(
      authorizeServiceRequest(
        "/api/hackathons",
        { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": secret },
        secret,
      ),
    ).toEqual({
      status: 403,
      body: { error: "Gateway identity headers are required." },
    });
  });

  it("accepts a gateway call with the shared secret and user identity", () => {
    expect(authorizeServiceRequest("/api/hackathons?limit=1", gatewayIdentity, secret)).toBeNull();
  });
});
