class PipelineWorkerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createDurablePipelineRuntime() {
  async function request(route, body) {
    const base = process.env.PIPELINE_WORKER_URL;
    const secret = process.env.GATEWAY_INTERNAL_SECRET;
    if (!base || !secret) {
      throw new PipelineWorkerError(503, "Configure PIPELINE_WORKER_URL and gateway authorization for the durable pipeline worker.");
    }
    let response;
    try {
      const target = new URL(`${base.replace(/\/$/, "")}/${route.replace(/^\//, "")}`);
      if (target.protocol !== "https:" && process.env.VERCEL === "1") {
        throw new Error("Production worker requires HTTPS.");
      }
      response = await fetch(target, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-gateway-caller": "team-2-gateway", "x-gateway-secret": secret,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(20000),
      });
    } catch {
      console.error("Durable pipeline worker request failed.");
      throw new PipelineWorkerError(502, "The durable pipeline worker could not be reached. Check its deployment and URL.");
    }
    let payload;
    try { payload = await response.json(); } catch {
      console.error("Durable pipeline worker returned invalid JSON.", response.status);
      throw new PipelineWorkerError(502, `The durable pipeline worker returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new PipelineWorkerError([400, 409, 413, 503].includes(response.status) ? response.status : 502,
        typeof payload?.error === "string" ? payload.error : `Pipeline worker returned HTTP ${response.status}.`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new PipelineWorkerError(502, "The durable pipeline worker returned an invalid response.");
    }
    return payload;
  }
  return {
    pipeline: {
      async get() {
        const payload = await request("/pipeline");
        if (!Object.hasOwn(payload, "job")) throw new PipelineWorkerError(502, "Pipeline worker returned an invalid status.");
        return payload.job;
      },
      async start(apiKey) {
        const { job } = await request("/pipeline/run", { apiKey });
        if (!job || typeof job.id !== "string") throw new PipelineWorkerError(502, "Pipeline worker did not confirm the queued job.");
        return job;
      },
    },
    schedule: {
      async get() { return (await request("/schedule")).schedule; },
      async update(frequency) { return (await request("/schedule", { frequency })).schedule; },
      close() {},
    },
  };
}
module.exports = { createDurablePipelineRuntime, PipelineWorkerError };
