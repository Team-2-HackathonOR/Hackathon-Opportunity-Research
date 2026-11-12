import { HttpError } from "./runtime.ts";

export const storageErrors = {
  STORAGE_CONFIG_MISSING: "Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Edge runtime; keep the service-role key server-side.",
  STORAGE_CONFIG_INVALID: "Storage configuration is invalid. Use an HTTPS Supabase project origin, a valid STAGING_STORAGE_BUCKET and a non-empty STAGING_STORAGE_PREFIX without dot segments.",
  STORAGE_BUCKET_MISSING: "The staging bucket does not exist. Create the private STAGING_STORAGE_BUCKET in Supabase Storage before running the pipeline.",
  STORAGE_BUCKET_PUBLIC: "The staging bucket is public. Make it private before writing or reading scraper data.",
  STORAGE_OBJECT_MISSING: "A staging object is missing. Check for concurrent cleanup or deletion; do not resume an incomplete import blindly.",
  STORAGE_AUTH_FAILED: "Storage authentication failed. Check SUPABASE_SERVICE_ROLE_KEY belongs to the project in SUPABASE_URL.",
  STORAGE_PERMISSION_DENIED: "Storage access was denied. Check the server credential and bucket permissions; do not make the bucket public.",
  STORAGE_CONNECTION_FAILED: "Could not connect to Supabase Storage. Check the project URL, service availability and outbound HTTPS connectivity.",
  STORAGE_TIMEOUT: "Storage operation timed out. A mutation may have completed; inspect its outcome before retrying or clearing a pipeline blocker.",
  STORAGE_RESPONSE_INVALID: "Storage returned an invalid response. Inspect the function logs and confirm the configured Supabase project endpoint.",
  STORAGE_MUTATION_UNCONFIRMED: "Storage did not acknowledge every expected object mutation. Inspect the bucket before retrying; the pipeline interlock is retained.",
  STORAGE_LIMIT_EXCEEDED: "Staging Storage exceeded a bounded request, cache or 10,000-object limit. Inspect the staging prefix and reduce the run size.",
  STORAGE_RECORD_INVALID: "A staging record or cursor is invalid. Records require a non-negative safe integer source ID and a valid fetchedAt timestamp.",
  STORAGE_REQUEST_FAILED: "Supabase Storage rejected the request. Inspect Storage service logs without exposing credentials.",
  STORAGE_RESET_FAILED: "Staging cleanup failed. Inspect function logs before retrying; an incomplete deletion may retain a safety blocker.",
} as const;

export class StorageError extends HttpError {
  constructor(public code: keyof typeof storageErrors, status: number) {
    super(status, storageErrors[code]);
    this.name = "StorageError";
  }
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

export function storageFailure(error: unknown) {
  const code = error instanceof StorageError ? error.code : "STORAGE_REQUEST_FAILED";
  console.error("Storage operation failed.", { code, kind: error instanceof StorageError ? "StorageError" : "unknown" });
  return { code, error: storageErrors[code] };
}

export async function serviceJson(response: Response): Promise<unknown> {
  if (response.ok) {
    try { return await response.json(); }
    catch { throw new HttpError(502, "Pipeline service returned invalid JSON. Inspect the upstream service logs."); }
  }
  let payload: unknown;
  try { payload = await readErrorBody(response); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `Pipeline service returned HTTP ${response.status} without a valid JSON error. Inspect its logs.`);
  }
  const code = field(payload, "code");
  if (isStorageCode(code)) {
    throw new HttpError(502, `[${code}] ${storageErrors[code]}`);
  }
  const hint = response.status === 401 || response.status === 403
    ? "Check gateway caller/shared-secret configuration and the Edge Function JWT verification setting."
    : response.status === 404 ? "Check the deployed service URL, route and function version."
    : "Inspect the upstream service logs; its raw response is not exposed.";
  throw new HttpError(502, `Pipeline service returned HTTP ${response.status}. ${hint}`);
}

function isStorageCode(value: unknown): value is keyof typeof storageErrors {
  return typeof value === "string" && Object.hasOwn(storageErrors, value);
}

async function readErrorBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing service error body.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) {
        await reader.cancel();
        throw new HttpError(502, `Pipeline service returned HTTP ${response.status} with an oversized error body. Inspect its logs.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
