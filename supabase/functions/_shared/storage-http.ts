import { StorageError } from "./service-errors.ts";

export const objectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function storageConfig() {
  const origin = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!origin || !key) throw new StorageError("STORAGE_CONFIG_MISSING", 503);
  let url: URL;
  try { url = new URL(origin); } catch { throw new StorageError("STORAGE_CONFIG_INVALID", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new StorageError("STORAGE_CONFIG_INVALID", 503);
  }
  const bucket = Deno.env.get("STAGING_STORAGE_BUCKET")?.trim() ?? "hackscout-staging";
  const prefix = Deno.env.get("STAGING_STORAGE_PREFIX")?.trim() ?? "hackscout/raw";
  if (!/^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$/.test(bucket) ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
    throw new StorageError("STORAGE_CONFIG_INVALID", 503);
  }
  return { origin: url.origin, key, bucket, prefix };
}

export const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new StorageError("STORAGE_LIMIT_EXCEEDED", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
  } finally { reader.releaseLock(); }
}

export async function storageRequest(path: string, method: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const { origin, key } = storageConfig();
  try {
    const response = await fetch(`${origin}/storage/v1/${path}`, {
      method, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", "x-upsert": "true" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await responseJson(response);
    if (!response.ok) {
      const status = objectRecord(result) && /^\d{3}$/.test(String(result.statusCode))
        ? Number(result.statusCode) : response.status;
      throw new StorageError(status === 401 ? "STORAGE_AUTH_FAILED"
        : status === 403 ? "STORAGE_PERMISSION_DENIED"
        : status === 404 ? path.startsWith("bucket/") ? "STORAGE_BUCKET_MISSING" : "STORAGE_OBJECT_MISSING"
        : "STORAGE_REQUEST_FAILED", response.status);
    }
    return result;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(signal.aborted || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
      ? "STORAGE_TIMEOUT" : "STORAGE_CONNECTION_FAILED", 503);
  }
}

export async function requirePrivateBucket(signal: AbortSignal) {
  const config = storageConfig();
  const bucket = await storageRequest(`bucket/${encodeURIComponent(config.bucket)}`, "GET", signal);
  if (!objectRecord(bucket) || typeof bucket.public !== "boolean") throw new StorageError("STORAGE_RESPONSE_INVALID", 502);
  if (bucket.public) throw new StorageError("STORAGE_BUCKET_PUBLIC", 503);
  return config;
}
