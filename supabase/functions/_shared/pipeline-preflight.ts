import { db, env, HttpError, PipelineFailure } from "./runtime.ts";
import { requirePrivateBucket } from "./storage-http.ts";
import { serviceJson } from "./service-errors.ts";

export async function preflightPipeline(): Promise<1> {
  const gateway = new URL(env("AUTH_GATEWAY_URL"));
  if ((gateway.protocol !== "https:" && Deno.env.get("ALLOW_LOCAL_GATEWAY") !== "true") ||
      gateway.username || gateway.password || gateway.search || gateway.hash) {
    throw new HttpError(503, "Configure a valid HTTPS gateway origin before starting the pipeline.");
  }
  const [schema] = await db()<{ ready: boolean }[]>`SELECT
    to_regclass('pipeline_control.dead_letters') IS NOT NULL
    AND to_regclass('pipeline_control.staging_index') IS NOT NULL
    AND to_regclass('pipeline_control.etl_receipts') IS NOT NULL
    AND to_regclass('pipeline_control.operation_attempts') IS NOT NULL AS ready`;
  if (!schema?.ready) throw new HttpError(503, "Apply the complete fault-tolerance migrations before starting the pipeline.");
  await requirePrivateBucket(AbortSignal.timeout(10000));
  let response: Response;
  try {
    response = await fetch(new URL("/api/internal/etl/health", gateway), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "x-gateway-caller": "team-2-gateway", "x-gateway-secret": env("GATEWAY_INTERNAL_SECRET") },
    });
  } catch {
    throw new PipelineFailure(503, "ETL_READINESS_UNAVAILABLE", "retry", "ETL readiness could not be reached; no run was started.");
  }
  const body = await serviceJson(response);
  if (!body || typeof body !== "object" || !("capabilities" in body) ||
      !body.capabilities || typeof body.capabilities !== "object" ||
      !("pipelineReceipts" in body.capabilities) || body.capabilities.pipelineReceipts !== 1) {
    throw new HttpError(503, "Deploy the receipt-aware ETL before starting; no run was created.");
  }
  return 1;
}
