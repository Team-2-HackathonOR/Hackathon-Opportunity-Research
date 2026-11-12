const express = require("express");

function createAuthRouter() {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "8kb" }));
  router.use(async (request, response) => {
    const route = request.path;
    const allowed = request.method === "POST" && ["/login", "/register", "/logout"].includes(route)
      || request.method === "GET" && route === "/me"
      || request.method === "DELETE" && route === "/account";
    if (!allowed) return response.status(404).json({ error: "Unknown authentication route." });
    const target = new URL(`/api/auth${route}`, process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        },
        ...(["POST", "DELETE"].includes(request.method) ? { body: JSON.stringify(request.body ?? {}) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      console.error("Authentication gateway could not be reached.");
      return response.status(502).json({ error: "The authentication service is unavailable. Please try again later." });
    }
    let payload;
    try {
      payload = JSON.parse(await upstream.text());
    } catch {
      console.error("Authentication gateway returned invalid JSON.", upstream.status);
      return response.status(502).json({ error: "The authentication service returned an invalid response." });
    }
    return response.status(upstream.status).json(payload);
  });
  router.use((error, _request, response, _next) => {
    const status = error.type === "entity.parse.failed" ? 400
      : error.type === "entity.too.large" ? 413 : 500;
    console.error("Authentication request failed.", error.type || "internal");
    response.status(status).json({ error: status === 413 ? "The request is too large." : "Invalid authentication request." });
  });
  return router;
}

module.exports = { createAuthRouter };
