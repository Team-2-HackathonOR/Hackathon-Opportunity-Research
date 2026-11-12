const { randomUUID } = require("node:crypto");
const http = require("node:http");
const https = require("node:https");

function requestPipelineService(target, options) {
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Pipeline service URLs must use HTTP or HTTPS.");
  }
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(target, {
      method: options.method,
      headers: options.headers,
    }, (response) => {
      let content = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { content += chunk; });
      response.on("error", reject);
      response.on("end", () => {
        const status = response.statusCode;
        if (!status) {
          reject(new Error("Pipeline service returned an invalid HTTP response."));
          return;
        }
        resolve({
          status,
          ok: status >= 200 && status < 300,
          json: async () => JSON.parse(content),
        });
      });
    });
    request.setTimeout(24 * 60 * 60 * 1000, () => {
      request.destroy(new Error("Pipeline service timed out."));
    });
    request.on("error", () => reject(new Error("Pipeline service could not be reached or the connection was interrupted.")));
    request.end(options.body);
  });
}

function createPipelineController(requestService = requestPipelineService) {
  let current = null;

  async function serviceRequest(route, apiKey, body) {
    const secret = process.env.GATEWAY_INTERNAL_SECRET;
    if (!secret) throw new Error("Gateway authorization is not configured.");
    const target = new URL(route, process.env.AUTH_GATEWAY_URL || "http://127.0.0.1:4000");
    const upstream = await requestService(target, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json", "x-ai-api-key": apiKey,
        "x-gateway-caller": "team-2-gateway", "x-gateway-secret": secret,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!upstream.ok) {
      throw new Error(`Service returned HTTP ${upstream.status}. Check its logs.`);
    }
    const payload = await upstream.json();
    if (!payload || typeof payload !== "object") throw new Error("Service returned an invalid response.");
    return payload;
  }

  async function execute(job, apiKey) {
    try {
      for (const [database, route, countField] of [
        ["mongodb", "/api/internal/scraper/hackathons/reset", "deletedRecords"],
        ["postgresql", "/api/internal/hackathons/reset", "deletedEvents"],
      ]) {
        const result = await serviceRequest(route, apiKey, {});
        if (result.reset !== true || !Number.isInteger(result[countField]) || result[countField] < 0) {
          throw new Error(`Invalid ${database} reset summary. Scraping was not started.`);
        }
        job.reset[database] = result[countField];
      }
      job.steps.reset.status = "completed";
      job.steps.reset.finishedAt = new Date().toISOString();
      job.stage = "scraper";
      job.steps.scraper.status = "running";
      job.steps.scraper.startedAt = job.steps.reset.finishedAt;
      const scrape = await serviceRequest(
        "/api/internal/scraper/hackathons/persist-all?startPage=1", apiKey,
      );
      if (scrape.persisted !== true || typeof scrape.fetchedAt !== "string" || !scrape.fetchedAt ||
          !Number.isInteger(scrape.pagesPersisted) || scrape.pagesPersisted < 0 ||
          !Number.isInteger(scrape.uniqueHackathonsPersisted) || scrape.uniqueHackathonsPersisted < 0) {
        throw new Error("Scraper returned an invalid run summary.");
      }
      job.scraper = {
        pagesPersisted: scrape.pagesPersisted,
        uniqueHackathonsPersisted: scrape.uniqueHackathonsPersisted,
      };
      job.steps.scraper.status = "completed";
      job.steps.scraper.finishedAt = new Date().toISOString();
      job.stage = "etl";
      job.steps.etl.status = "running";
      job.steps.etl.startedAt = job.steps.scraper.finishedAt;
      const etl = await serviceRequest(
        "/api/internal/etl/etl/import/mongodb", apiKey,
        { fetched_at: scrape.fetchedAt, limit: null, use_ai_normalization: true },
      );
      if (!Number.isInteger(etl.processed_count) || etl.processed_count < 0 ||
          !Number.isInteger(etl.inserted_count) || etl.inserted_count < 0 ||
          !Number.isInteger(etl.failed_count) || etl.failed_count < 0 ||
          etl.inserted_count + etl.failed_count !== etl.processed_count) {
        throw new Error("ETL returned an invalid import summary.");
      }
      job.etl = {
        processed: etl.processed_count, inserted: etl.inserted_count, failed: etl.failed_count,
      };
      if (etl.processed_count !== scrape.uniqueHackathonsPersisted) {
        throw new Error("ETL record count does not match this scrape. Check that both services use the same MongoDB database and collection.");
      }
      if (etl.failed_count) throw new Error(`${etl.failed_count} ETL records failed. Successful inserts remain saved; check ETL logs before retrying.`);
      job.status = "completed";
      job.steps.etl.status = "completed";
      job.stage = "done";
    } catch (error) {
      console.error(`Admin pipeline failed at ${job.stage}.`);
      job.status = "failed";
      job.steps[job.stage].status = "failed";
      for (const step of Object.values(job.steps)) {
        if (step.status === "waiting") step.status = "skipped";
      }
      job.error = error instanceof SyntaxError ? "Service returned invalid JSON."
        : error instanceof TypeError ? "Service could not be reached."
          : error.name === "TimeoutError" ? "Service timed out."
            : error.message;
    } finally {
      job.finishedAt = new Date().toISOString();
      const lastStep = job.steps.etl.startedAt ? job.steps.etl
        : job.steps.scraper.startedAt ? job.steps.scraper : job.steps.reset;
      lastStep.finishedAt = job.finishedAt;
    }
  }

  return {
    start(apiKey) {
      if (current?.status === "running") return null;
      current = {
        id: randomUUID(), status: "running", stage: "reset", reset: {},
        startedAt: new Date().toISOString(),
      };
      current.steps = {
        reset: { status: "running", startedAt: current.startedAt },
        scraper: { status: "waiting" },
        etl: { status: "waiting" },
      };
      void execute(current, apiKey);
      return current;
    },
    get() { return current; },
  };
}

module.exports = { createPipelineController };
