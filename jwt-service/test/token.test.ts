import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { signAccessToken } from "../src/lib/token.js";

const secret = "test-jwt-secret-at-least-32-characters";
const issuer = "team-2-gateway";
const user = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "researcher@local",
  role: "researcher" as const,
};

describe("signAccessToken", () => {
  it("signs a token with user id, email, role, token id, claim hash, and expiry", async () => {
    const signed = await signAccessToken(user, { secret, issuer, ttlSeconds: 7200 });
    const { payload } = await jwtVerify(signed.token, new TextEncoder().encode(secret), {
      issuer,
      algorithms: ["HS256"],
    });

    expect(payload.sub).toBe(user.id);
    expect(payload.userId).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.role).toBe(user.role);
    expect(payload.iss).toBe(issuer);
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload.sha).toBe(signed.record.tokenSha);
    expect(signed.record.role).toBe(user.role);
    expect(signed.expiresAt).toBe(new Date((payload.exp ?? 0) * 1000).toISOString());
  });

  it("produces a token that verification rejects after expiry", async () => {
    const signed = await signAccessToken(user, {
      secret,
      issuer,
      ttlSeconds: 30,
      now: Math.floor(Date.now() / 1000) - 120,
    });

    await expect(
      jwtVerify(signed.token, new TextEncoder().encode(secret), { issuer, algorithms: ["HS256"] }),
    ).rejects.toThrow();
  });
});
