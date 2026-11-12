const { AdminError } = require("./admin-validation");

function createAdminUpstream(getSupabaseConfig) {
  async function authRequest(route, { authorization, body } = {}) {
    const base = new URL(process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
    const target = new URL(`/api/auth/${route}`, base);
    const upstream = await fetch(target, {
      method: route === "me" ? "GET" : "POST",
      headers: {
        ...(route === "me" ? {} : { "Content-Type": "application/json" }),
        ...(authorization ? { authorization } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      console.error("Administrator authentication gateway rejected a request.", {
        origin: target.origin, path: target.pathname, status: upstream.status,
      });
      const status = [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 502;
      const message = upstream.status === 401 ? "Invalid credentials or an expired session."
        : upstream.status === 429 ? "Too many login attempts. Please try again later."
          : `The authentication gateway returned HTTP ${upstream.status} for ${target.pathname}. Check the HackScout backend's AUTH_GATEWAY_URL and the gateway deployment logs.`;
      throw new AdminError(status, message);
    }
    return upstream.json();
  }

  async function verifiedAdmin(authorization) {
    if (!authorization || !/^Bearer \S+$/.test(authorization)) {
      throw new AdminError(401, "Sign in with an administrator account.");
    }
    const user = await authRequest("me", { authorization });
    if (!user || typeof user.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ||
        typeof user.email !== "string" || typeof user.expiresAt !== "string") {
      throw new AdminError(502, "The authentication service returned an invalid session.");
    }
    if (user.role !== "admin") throw new AdminError(403, "An administrator role is required.");
    return user;
  }

  async function supabaseRequest(route, { method = "GET", body, count = false } = {}) {
    const { endpoint, secretKey } = getSupabaseConfig();
    const project = new URL(endpoint);
    if (project.protocol !== "https:") throw new AdminError(503, "Supabase must be configured with HTTPS.");
    const upstream = await fetch(new URL(`/rest/v1/${route}`, project.origin), {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Accept-Profile": "public",
        "Content-Profile": "public",
        ...(count ? { Prefer: "count=exact" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      if (payload.code === "P0002") throw new AdminError(404, "This submission no longer exists.");
      if (payload.code === "P0001") throw new AdminError(409, "This submission has already been reviewed. Refresh the queue.");
      if (payload.code === "23505") throw new AdminError(409, "A listing with these event details already exists. Check for a duplicate before publishing.");
      console.error("Moderation database request failed:", upstream.status, payload.code);
      throw new AdminError(502, "The moderation database is unavailable. Check the migration and Supabase permissions.");
    }
    return { payload, range: upstream.headers.get("content-range") };
  }

  return { authRequest, verifiedAdmin, supabaseRequest };
}

module.exports = { createAdminUpstream };
