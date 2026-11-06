const express = require("express");

async function requireSession(request, response, next) {
  const authorization = request.headers.authorization;
  response.set("Cache-Control", "no-store");
  if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
    return response.status(401).json({ error: "Sign in to access HackScout." });
  }
  try {
    const base = new URL(process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
    const upstream = await fetch(new URL("/api/auth/me", base), {
      headers: { authorization },
      signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 401 || upstream.status === 403) {
      return response.status(401).json({ error: "Your session has expired. Sign in again." });
    }
    if (!upstream.ok) throw new Error(`Authentication gateway returned HTTP ${upstream.status}.`);
    const user = await upstream.json();
    if (!user || typeof user.email !== "string" ||
        !["admin", "researcher", "viewer"].includes(user.role)) {
      throw new Error("Authentication gateway returned an invalid session.");
    }
    next();
  } catch (error) {
    console.error("Session verification failed:", error.message);
    response.status(502).json({ error: "The authentication service is unavailable." });
  }
}

function createAuthRouter() {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "10kb" }));

  async function forward(request, response) {
    try {
      const base = new URL(process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
      const target = new URL(`/api/auth${request.path}`, base);
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        },
        ...(request.method === "POST" ? { body: JSON.stringify(request.body || {}) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await upstream.text();
      response.status(upstream.status).type("application/json").send(payload);
    } catch (error) {
      console.error("Authentication gateway request failed:", error.message);
      response.status(502).json({ error: "The authentication service is unavailable." });
    }
  }

  router.post("/login", forward);
  router.get("/me", forward);
  router.post("/logout", forward);
  router.use((error, _request, response, _next) => {
    const status = error.type === "entity.too.large" ? 413 : 400;
    response.status(status).json({ error: status === 413 ? "The request is too large." : "Enter valid JSON." });
  });
  return router;
}

module.exports = { createAuthRouter, requireSession };
