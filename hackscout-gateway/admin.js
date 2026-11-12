const express = require("express");
const { createPipelineController } = require("./pipeline");
const { createPipelineSchedule } = require("./pipeline-schedule");
const { createDurablePipelineRuntime, PipelineWorkerError } = require("./durable-pipeline");
const { AdminError, moderationBody, text } = require("./admin-validation");
const { createAdminUpstream } = require("./admin-upstream");

function createAdminRouter(
  getSupabaseConfig,
  getScraperUrl = () => process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000",
  scheduleOptions = {},
) {
  const router = express.Router();
  const durable = process.env.VERCEL === "1" || !!process.env.PIPELINE_WORKER_URL;
  const runtime = durable ? createDurablePipelineRuntime() : null;
  const pipeline = runtime ? runtime.pipeline : createPipelineController();
  const schedule = runtime ? runtime.schedule : createPipelineSchedule(pipeline, scheduleOptions);
  router.closeScheduler = () => schedule.close();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  const { authRequest, verifiedAdmin, supabaseRequest } = createAdminUpstream(getSupabaseConfig);

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
    if (request.gatewayAuthenticated) {
      const id = request.get("x-user-id");
      const email = request.get("x-user-email");
      if (request.get("x-user-role") !== "admin") {
        throw new AdminError(403, "An administrator role is required.");
      }
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
          !email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
        throw new AdminError(401, "The gateway did not supply a valid administrator identity.");
      }
      request.adminUser = { id, email, role: "admin" };
    } else {
      request.adminUser = await verifiedAdmin(request.headers.authorization);
    }
    next();
  });
  router.get("/session", (request, response) => response.json(request.adminUser));
  router.get("/pipeline", async (_request, response) => response.json({ job: await pipeline.get() }));
  router.get("/pipeline/schedule", async (_request, response) => response.json({ schedule: await schedule.get() }));
  router.post("/pipeline/schedule", express.json({ limit: "1kb" }), async (request, response) => {
    const frequency = request.body?.frequency;
    if (!["off", "weekly", "biweekly", "monthly"].includes(frequency)) {
      throw new AdminError(400, "Choose disabled, weekly, every two weeks, or monthly.");
    }
    if (!durable && frequency !== "off" && !process.env.AI_API_KEY?.trim()) {
      throw new AdminError(400, "Configure AI_API_KEY on the HackScout backend before enabling automatic runs.");
    }
    response.json({ schedule: await schedule.update(frequency) });
  });
  router.post("/pipeline/run", express.json({ limit: "8kb" }), async (request, response) => {
    const apiKey = text(request.body?.apiKey, "AI API key", 4096, true);
    const job = await pipeline.start(apiKey);
    if (!job) throw new AdminError(409, "A pipeline run is already in progress.");
    response.status(202).json({ job });
  });
  router.post("/logout", async (request, response) => {
    await authRequest("logout", { authorization: request.headers.authorization, body: {} });
    response.json({ status: "signed_out" });
  });
  router.post("/scraper/run", express.json({ limit: "8kb" }), async (request, response) => {
    const apiKey = text(request.body?.apiKey, "AI API key", 4096, true);
    const scraperUrl = new URL(getScraperUrl());
    if (!["http:", "https:"].includes(scraperUrl.protocol)) {
      throw new AdminError(503, "The scraper service URL must use HTTP or HTTPS.");
    }
    const target = new URL("/api/internal/scraper/hackathons/persist-all?startPage=1", scraperUrl);
    if (!process.env.GATEWAY_INTERNAL_SECRET) {
      throw new AdminError(503, "Gateway authorization is not configured.");
    }
    let upstream;
    try {
      upstream = await fetch(target, {
        headers: {
          "x-ai-api-key": apiKey,
          "x-gateway-caller": "team-2-gateway",
          "x-gateway-secret": process.env.GATEWAY_INTERNAL_SECRET,
        },
        signal: AbortSignal.timeout(600000),
      });
    } catch {
      throw new AdminError(502, "The scraper could not be reached or timed out.");
    }
    let payload;
    try {
      payload = JSON.parse(await upstream.text());
    } catch {
      throw new AdminError(502, "The scraper returned an empty or invalid response.");
    }
    if (!upstream.ok) {
      throw new AdminError(502, "The scraper run failed. Check the scraper service logs.");
    }
    if (!payload || payload.persisted !== true ||
        !Number.isInteger(payload.pagesPersisted) ||
        !Number.isInteger(payload.hackathonsPersisted) ||
        !Number.isInteger(payload.uniqueHackathonsPersisted)) {
      throw new AdminError(502, "The scraper returned an invalid run summary.");
    }
    response.json({
      pagesPersisted: payload.pagesPersisted,
      hackathonsPersisted: payload.hackathonsPersisted,
      uniqueHackathonsPersisted: payload.uniqueHackathonsPersisted,
    });
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
    const status = error instanceof AdminError || error instanceof PipelineWorkerError ? error.status
      : error.type === "entity.parse.failed" ? 400 : error.type === "entity.too.large" ? 413 : 502;
    const message = error instanceof AdminError || error instanceof PipelineWorkerError ? error.message
      : status === 400 ? "Enter valid JSON." : status === 413 ? "The request is too large."
        : "The admin service is unavailable. Check the authentication gateway and database configuration.";
    response.status(status).json({ error: message });
  });
  return router;
}

module.exports = { createAdminRouter, moderationBody };
