require("dotenv").config();

const express = require("express");
const path = require("node:path");
const { createAdminRouter } = require("./admin");
const { createAuthRouter } = require("./auth");
const { createFrontendProxy } = require("./frontend-proxy");
const { requireGateway } = require("./gateway-auth");

const app = express();
const port = Number(process.env.PORT || 3000);
app.use("/api/hackscout", createFrontendProxy());
app.use("/api/auth", createAuthRouter());
app.use("/api", requireGateway);

const { getEvents, getSupabaseConfig } = require("./events");

app.get("/api/health", async (_request, response, next) => {
  try {
    await getEvents();
    response.json({ status: "ok", database: "connected", api: "graphql" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/hackathons", async (_request, response, next) => {
  try {
    response.json(await getEvents());
  } catch (error) {
    next(error);
  }
});

app.post("/api/suggestions", express.json({ limit: "10kb" }), async (request, response, next) => {
  const eventName = typeof request.body?.event === "string" ? request.body.event.trim() : "";
  const website = typeof request.body?.website === "string" ? request.body.website.trim() : "";
  let parsedWebsite;

  try {
    parsedWebsite = new URL(website);
  } catch {
    return response.status(400).json({ error: "Enter a valid event name and website." });
  }

  if (!eventName || eventName.length > 160 || website.length > 2048 ||
      !["http:", "https:"].includes(parsedWebsite.protocol)) {
    return response.status(400).json({ error: "Enter a valid event name and website." });
  }

  try {
    const { endpoint: graphqlEndpoint, secretKey } = getSupabaseConfig();

    const projectUrl = new URL(graphqlEndpoint);
    if (projectUrl.protocol !== "https:") {
      throw new Error("SUPABASE_GRAPHQL_URL must use HTTPS.");
    }

    const insertResponse = await fetch(`${projectUrl.origin}/rest/v1/event_suggestions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ event_name: eventName, website })
    });

    if (!insertResponse.ok) {
      throw new Error(`Supabase suggestion insert failed (HTTP ${insertResponse.status}).`);
    }

    response.status(201).json({ status: "submitted" });
  } catch (error) {
    next(error);
  }
});

const adminRouter = createAdminRouter(getSupabaseConfig);
app.use("/api/admin", adminRouter);
app.use("/admin", express.static(path.join(__dirname, "..", "admin-ui")));
app.use("/hackscout-admin", express.static(path.join(__dirname, "..", "admin-ui")));
app.use(express.static(path.join(__dirname, "..", "hackscout-ui")));

app.use((error, _request, response, _next) => {
  console.error("Request failed:", error);
  if (response.headersSent) return;
  response.status(500).json({ error: "The request could not be completed." });
});

if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`HackScout is running at http://localhost:${port}`);
  });
  server.once("close", adminRouter.closeScheduler);
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

module.exports = app;
