const http = require("node:http");
const { ports, urls } = require("./local-config.cjs");
const year = new Date().getUTCFullYear() + 1;
function lead(id, title, submission = `Jan 1 - Dec 31, ${year}`) {
  return { id, title, submission_period_dates: submission, open_state: "open",
    url: `https://events.example.test/${id}`, organization_name: "CI organizer",
    displayed_location: { location: "Online", icon: "globe" }, thumbnail_url: "", time_left_to_submission: "",
    themes: [{ id: 1, name: "AI" }], prize_amount: "$100", prizes_counts: { cash: 1, other: 0 },
    registrations_count: 3, featured: false, winners_announced: false, submission_gallery_url: "",
    start_a_submission_url: `https://events.example.test/${id}/register`, invite_only: false,
    managed_by_devpost_badge: false };
}
const pages = [
  [lead(11, "CI pipeline first"), lead(12, "CI malformed lead")],
  [lead(13, "CI pipeline last"), lead(14, "CI expired lead", "Jan 1 - Dec 31, 2011")],
];
async function startProviders(secret) {
  const stats = { scrapeRequests: 0, aiRequests: 0, transientFailures: 0 };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, urls.providers);
      const send = (status, body) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/health" || url.pathname === "/stats") return send(200, stats);
      if (url.pathname === "/tick" && request.method === "POST") {
        const result = await fetch(`${urls.gateway}/api/internal/pipeline-worker/pipeline/tick`, {
          method: "POST", headers: { "x-gateway-secret": secret, "x-gateway-caller": "team-2-gateway" },
          signal: AbortSignal.timeout(120000),
        });
        response.writeHead(result.status, { "content-type": "application/json" });
        return response.end(await result.text());
      }
      if (url.pathname === "/api/hackathons") {
        stats.scrapeRequests++;
        const page = Number(url.searchParams.get("page") ?? 1);
        const scenario = url.searchParams.get("ci_case");
        const hackathons = (pages[page - 1] ?? []).map((item) =>
          scenario ? { ...item, title: `${item.title} ${scenario}` } : item);
        return send(200, { hackathons,
          meta: { total_count: 4, per_page: 2, page, total_pages: 2, next_page: page < 2 ? page + 1 : null } });
      }
      if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
        if (request.headers.authorization !== "Bearer ci-fixture-key") return send(401, { error: "Invalid fixture key" });
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 1000000) return send(413, { error: "Fixture input too large" });
        }
        const input = JSON.parse(body);
        const prompt = input.messages.find((message) => message.role === "user").content;
        const match = /Base draft:\n([\s\S]*?)\nRaw source:\n/.exec(prompt);
        if (!match) return send(400, { error: "Missing base draft" });
        const base = JSON.parse(match[1]);
        stats.aiRequests++;
        if (base.event_name === "CI pipeline first" && stats.transientFailures === 0) {
          stats.transientFailures++;
          return send(503, { error: "Planned transient provider failure" });
        }
        const content = base.event_name === "CI malformed lead" ? "invalid JSON"
          : JSON.stringify({ ...base, event_start_date: `${year}-01-01`, event_end_date: `${year}-12-31` });
        return send(200, { choices: [{ message: { content } }] });
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<html><title>CI official fixture</title><body>Online hackathon, Jan 1 - Dec 31, ${year}.</body></html>`);
    } catch (error) {
      console.error("Fixture provider failed:", error.message);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Fixture provider failed" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(ports.providers, "127.0.0.1", resolve);
  });
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
}
module.exports = { startProviders };
