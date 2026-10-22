import { jwtVerify } from "jose";
import { vi } from "vitest";

import { TEST_JWT_ISSUER, TEST_JWT_SECRET } from "./constants.js";

const encoder = new TextEncoder();

export function stubTokenVerification(
  onOther?: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (!url.endsWith("/verify")) {
      if (onOther) {
        return onOther(url, init);
      }
      return new Response(JSON.stringify({ error: "unexpected fetch" }), { status: 500 });
    }

    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    try {
      const { payload } = await jwtVerify(token, encoder.encode(TEST_JWT_SECRET), {
        issuer: TEST_JWT_ISSUER,
        algorithms: ["HS256"],
      });
      return new Response(
        JSON.stringify({
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    } catch {
      return new Response(JSON.stringify({ error: "Invalid or expired token." }), { status: 401 });
    }
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
