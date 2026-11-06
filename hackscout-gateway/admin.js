const express = require("express");

class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, name, max, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new AdminError(400, `Enter a valid ${name} (maximum ${max} characters).`);
  }
  return value.trim();
}

function website(value, name, required = false) {
  const result = text(value, name, 2048, required);
  if (!result) return "";
  let url;
  try {
    url = new URL(result);
  } catch {
    throw new AdminError(400, `Enter a valid ${name}.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AdminError(400, `Enter an HTTP or HTTPS ${name} without embedded credentials.`);
  }
  return result;
}

function date(value, name, required = false) {
  const result = text(value, name, 10, required);
  if (!result) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) {
    throw new AdminError(400, `Enter a valid ${name}.`);
  }
  return result;
}

function moderationBody(body) {
  if (!body || !["approved", "rejected"].includes(body.decision)) {
    throw new AdminError(400, "Choose approve or reject.");
  }
  const notes = text(body.notes, "review note", 2000, body.decision === "rejected");
  if (body.decision === "rejected") return { decision: body.decision, notes, event: {} };
  const source = body.event;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AdminError(400, "Event details are required before publishing.");
  }
  if (!["in_person", "virtual", "hybrid"].includes(source.format)) {
    throw new AdminError(400, "Choose in-person, virtual, or hybrid.");
  }
  const event = {
    event_name: text(source.event_name, "event name", 160, true),
    organizer_name: text(source.organizer_name, "organizer", 160, true),
    official_website: website(source.official_website, "official website", true),
    registration_link: website(source.registration_link, "registration link"),
    format: source.format,
    event_start_date: date(source.event_start_date, "start date", true),
    event_end_date: date(source.event_end_date, "end date"),
    city: text(source.city, "city", 160),
    country: text(source.country, "country", 160),
    description: text(source.description, "event description", 4000, true),
    technical_tracks: text(source.technical_tracks, "topics", 1000),
    registration_fee_notes: text(source.registration_fee_notes, "fee details", 500),
  };
  if (event.event_end_date && event.event_end_date < event.event_start_date) {
    throw new AdminError(400, "The end date cannot precede the start date.");
  }
  if (event.format !== "virtual" && (!event.city || !event.country)) {
    throw new AdminError(400, "City and country are required for in-person and hybrid events.");
  }
  return { decision: body.decision, notes, event };
}

function createAdminRouter(getSupabaseConfig) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  async function authRequest(route, { authorization, body } = {}) {
    const base = new URL(process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
    const target = new URL(`/api/auth/${route}`, base);
    const upstream = await fetch(target, {
      method: route === "me" ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      const status = [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 502;
      const message = upstream.status === 401 ? "Invalid credentials or an expired session."
        : upstream.status === 429 ? "Too many login attempts. Please try again later."
          : "The authentication service could not complete this request.";
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

  router.post("/login", express.json({ limit: "10kb" }), async (request, response) => {
    const email = text(request.body?.email, "email", 254, true);
    const password = request.body?.password;
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || typeof password !== "string" || !password || password.length > 1024) {
      throw new AdminError(400, "Enter your email and password.");
    }
    const session = await authRequest("login", { body: { email, password } });
    if (!session || typeof session.token !== "string") {
      throw new AdminError(502, "The authentication service returned an invalid session.");
    }
    try {
      const user = await verifiedAdmin(`Bearer ${session.token}`);
      response.json({ token: session.token, user });
    } catch (error) {
      await authRequest("logout", { authorization: `Bearer ${session.token}`, body: {} });
      throw error;
    }
  });

  router.use(async (request, _response, next) => {
    request.adminUser = await verifiedAdmin(request.headers.authorization);
    next();
  });
  router.get("/session", (request, response) => response.json(request.adminUser));
  router.post("/logout", async (request, response) => {
    await authRequest("logout", { authorization: request.headers.authorization, body: {} });
    response.json({ status: "signed_out" });
  });
  router.get("/suggestions", async (request, response) => {
    const status = request.query.status || "pending";
    const pageValue = request.query.page || "1";
    if (!["all", "pending", "approved", "rejected"].includes(status) ||
        typeof pageValue !== "string" || !/^[1-9]\d{0,5}$/.test(pageValue)) {
      throw new AdminError(400, "Choose a valid status and page.");
    }
    const page = Number(pageValue);
    const pageSize = 12;
    const query = new URLSearchParams({
      select: "id,event_name,website,status,submitted_at,reviewed_at,reviewed_by,review_notes,published_event_id",
      order: "submitted_at.desc,id.desc",
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (status !== "all") query.set("status", `eq.${status}`);
    const search = text(request.query.search, "search", 160);
    if (search) {
      const escaped = search.replace(/[%_*\\"]/g, (character) => `\\${character}`);
      query.set("or", `(event_name.ilike."*${escaped}*",website.ilike."*${escaped}*")`);
    }
    const { payload, range } = await supabaseRequest(`event_suggestions?${query}`, { count: true });
    const total = range?.split("/")[1];
    if (!Array.isArray(payload) || !total || !/^\d+$/.test(total)) {
      throw new AdminError(502, "The moderation database returned an invalid queue.");
    }
    response.json({ items: payload, total: Number(total), page, pageSize });
  });
  router.post("/suggestions/:id/review", express.json({ limit: "64kb" }), async (request, response) => {
    if (!/^[1-9]\d{0,18}$/.test(request.params.id) || BigInt(request.params.id) > 9223372036854775807n) {
      throw new AdminError(400, "Choose a valid submission.");
    }
    const input = moderationBody(request.body);
    const { payload } = await supabaseRequest("rpc/moderate_event_suggestion", {
      method: "POST",
      body: {
        suggestion_id: request.params.id,
        decision: input.decision,
        reviewer_id: request.adminUser.id,
        notes: input.notes,
        event_details: input.event,
      },
    });
    if (!payload || payload.status !== input.decision ||
        (input.decision === "approved" && !payload.published_event_id)) {
      throw new AdminError(502, "The moderation database returned an invalid review result.");
    }
    response.json(payload);
  });
  router.use((error, _request, response, _next) => {
    console.error("Admin request failed:", error);
    const status = error instanceof AdminError ? error.status
      : error.type === "entity.parse.failed" ? 400 : error.type === "entity.too.large" ? 413 : 502;
    const message = error instanceof AdminError ? error.message
      : status === 400 ? "Enter valid JSON." : status === 413 ? "The request is too large."
        : "The admin service is unavailable. Check the authentication gateway and database configuration.";
    response.status(status).json({ error: message });
  });
  return router;
}

module.exports = { createAdminRouter, moderationBody };
