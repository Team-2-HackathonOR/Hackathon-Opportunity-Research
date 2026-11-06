#!/usr/bin/env node

/**
 * Post-deploy smoke checks for gateway + jwt-service + hackathon-service.
 *
 * Usage:
 *   npm run smoke
 *   GATEWAY_BASE_URL=https://gateway.example.com npm run smoke
 *   SMOKE_EMAIL=viewer@local SMOKE_PASSWORD=change-me-viewer npm run smoke
 */

const baseUrl = (process.env.GATEWAY_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.SMOKE_EMAIL ?? "viewer@local";
const password = process.env.SMOKE_PASSWORD ?? "change-me-viewer";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

async function request(method, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { response, text, json };
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);

  const live = await request("GET", "/health/live");
  if (live.response.status !== 200) {
    fail(`/health/live returned ${live.response.status}`);
  } else {
    ok("/health/live");
  }

  const ready = await request("GET", "/health/ready");
  if (ready.response.status !== 200) {
    fail(`/health/ready returned ${ready.response.status}: ${ready.text}`);
  } else {
    ok("/health/ready");
  }

  const badLogin = await request("POST", "/api/auth/login", {
    body: { email, password: "definitely-wrong-password" },
  });
  if (badLogin.response.status !== 401) {
    fail(`bad login expected 401, got ${badLogin.response.status}`);
  } else {
    ok("bad login rejected with 401");
  }

  const login = await request("POST", "/api/auth/login", {
    body: { email, password },
  });
  const token = login.json?.token ?? login.json?.accessToken;
  if (login.response.status !== 200 || typeof token !== "string" || token.length < 20) {
    fail(`login failed (${login.response.status}): ${login.text}`);
    return;
  }
  ok("login issued a bearer token");

  const hackathons = await request("GET", "/api/hackathons", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (hackathons.response.status === 401 || hackathons.response.status === 403) {
    fail(`authenticated /api/hackathons was blocked by the gateway (${hackathons.response.status})`);
  } else if (hackathons.response.status >= 500) {
    fail(`authenticated /api/hackathons upstream error (${hackathons.response.status}): ${hackathons.text}`);
  } else {
    ok(`authenticated /api/hackathons returned ${hackathons.response.status}`);
  }

  if (process.exitCode) {
    console.error("Smoke test failed.");
    process.exit(1);
  }
  console.log("Smoke test passed.");
}

main().catch((error) => {
  const cause = error?.cause;
  if (cause?.code === "ECONNREFUSED") {
    console.error(
      `FAIL: could not reach ${baseUrl}. Start the stack (npm run dev or docker compose up) and retry.`,
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});
