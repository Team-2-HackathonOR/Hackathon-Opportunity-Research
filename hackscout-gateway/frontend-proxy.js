const express = require("express");

function createFrontendProxy() {
  const router = express.Router();
  router.use(express.raw({ type: () => true, limit: "64kb" }));
  router.use(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const base = process.env.AUTH_GATEWAY_URL ||
      (process.env.VERCEL === "1" ? undefined : "http://127.0.0.1:4000");
    if (!base) {
      console.error("Set AUTH_GATEWAY_URL to the deployed main gateway URL.");
      return response.status(503).json({ error: "The main gateway URL is not configured." });
    }

    let target;
    try {
      target = new URL(request.originalUrl, base);
      if (!["http:", "https:"].includes(target.protocol) ||
          target.host === request.get("host") || request.get("x-hackscout-proxy-hop")) {
        throw new Error("Invalid main gateway target.");
      }
    } catch {
      console.error("AUTH_GATEWAY_URL must point to a separate HTTP(S) main gateway.");
      return response.status(503).json({ error: "The main gateway URL is invalid." });
    }

    const headers = { "x-hackscout-proxy-hop": "1" };
    for (const name of ["authorization", "content-type", "x-request-id"]) {
      const value = request.get(name);
      if (value) headers[name] = value;
    }

    let upstream;
    let body;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        ...(request.method !== "GET" && request.method !== "HEAD" && request.body?.length
          ? { body: request.body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      body = await upstream.text();
    } catch {
      console.error("HackScout could not reach the main gateway.");
      return response.status(502).json({ error: "The main gateway is unavailable. Please try again later." });
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      console.error("The main gateway unexpectedly redirected an API request.");
      return response.status(502).json({ error: "The main gateway returned an unexpected redirect." });
    }
    for (const name of ["content-type", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      const value = upstream.headers.get(name);
      if (value) response.set(name, value);
    }
    return response.status(upstream.status).send(body);
  });
  router.use((error, _request, response, _next) => {
    const status = error.type === "entity.too.large" ? 413 : 500;
    console.error("HackScout gateway proxy request failed.", error.type || "internal");
    response.status(status).json({
      error: status === 413 ? "The request is too large." : "The gateway request could not be completed.",
    });
  });
  return router;
}

module.exports = { createFrontendProxy };
