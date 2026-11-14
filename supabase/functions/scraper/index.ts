import { authorize,functionPath,safeError } from "../_shared/runtime.ts";
import { handlePipeline } from "./pipeline.ts";
import { handleScraper } from "./service.ts";
import { handleClear } from "../_shared/pipeline-clear.ts";
import { handleDeadLetters } from "../_shared/pipeline-dead-letters.ts";
import { handleNextStep } from "../_shared/pipeline-next-step.ts";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    authorize(request);
    let path = functionPath(request, "scraper");
    if (path === "/pipeline/schedule") path = "/schedule";
    if (path === "/schedule" || path === "/pipeline" || path.startsWith("/pipeline/")) {
      const hasUser = request.headers.has("x-user-id") || request.headers.has("x-user-role");
      const deadLetters = path === "/pipeline/dead-letters" || path.startsWith("/pipeline/dead-letters/");
      if ((deadLetters || ["/pipeline/cancel", "/pipeline/restart", "/pipeline/continue", "/pipeline/clear", "/pipeline/next-step"].includes(path)) && request.headers.get("x-user-role") !== "admin") {
        return Response.json({ error: "An administrator role is required." }, { status: 403 });
      }
      if (hasUser && (path === "/pipeline/tick" || request.headers.get("x-user-role") !== "admin")) {
        return Response.json({ error: "Internal pipeline access is required." }, { status: 403 });
      }
      if (path === "/pipeline/clear") return await handleClear(request);
      if (deadLetters) return await handleDeadLetters(request, path);
      if (path === "/pipeline/next-step") return await handleNextStep(request);
      return await handlePipeline(request, path);
    }
    return await handleScraper(request, path);
  } catch (error) { return safeError(error); }
}

if (import.meta.main) Deno.serve(handleRequest);
