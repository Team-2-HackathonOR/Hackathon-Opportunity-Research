import { PipelineFailure } from "../runtime.ts";
type JsonRequestOptions = {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};
export type JsonResult<T> =
  | { ok: true; statusCode: number; body: T }
  | { ok: false; statusCode: number };

const transient = (status: number) => [408, 429, 500, 502, 503, 504].includes(status);
async function responseJson<T>(response: Response): Promise<T> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 5_000_000) {
          await reader.cancel();
          throw new PipelineFailure(413, "UPSTREAM_RESPONSE_INVALID", "pause", "Upstream response exceeds the size limit.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new PipelineFailure(502, "UPSTREAM_RESPONSE_INVALID", "pause", "Upstream returned invalid JSON."); }
}

export async function requestJson<T>(url: string, options: JsonRequestOptions): Promise<JsonResult<T>> {
  const budget = Math.min(options.timeoutMs ?? 20000, 25000);
  const deadline = Date.now() + budget;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, 8000));
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: { ...options.headers, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal, redirect: "error",
      });
      if (response.ok) return { ok: true, statusCode: response.status, body: await responseJson<T>(response) };
      await response.body?.cancel();
      if (!transient(response.status) || attempt === 3) return { ok: false, statusCode: response.status };
      console.warn("Upstream read retry scheduled.", { attempt, status: response.status });
    } catch (error) {
      if (error instanceof PipelineFailure) throw error;
      const timedOut = controller.signal.aborted || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      if (attempt === 3 || deadline <= Date.now()) {
        throw new PipelineFailure(503, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_CONNECTION_FAILED", "retry",
          timedOut ? "Upstream request timed out before persistence." : "Upstream connection failed before persistence.");
      }
      console.warn("Upstream read retry scheduled.", { attempt, kind: timedOut ? "timeout" : "connection" });
    } finally { clearTimeout(timer); }
    const delay = Math.min(250 * 2 ** (attempt - 1), Math.max(0, deadline - Date.now()));
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new PipelineFailure(503, "UPSTREAM_TIMEOUT", "retry", "Upstream request budget exhausted before persistence.");
}
