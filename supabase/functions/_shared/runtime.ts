import { timingSafeEqual } from "node:crypto";
import postgres from "npm:postgres@3.4.7";
import { MongoClient, type Collection, type Document } from "npm:mongodb@6.21.0";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(503, `Server configuration is missing ${name}.`);
  return value;
}

export function authorize(request: Request): void {
  const expected = env("GATEWAY_INTERNAL_SECRET");
  if (expected.length < 16) throw new HttpError(503, "Gateway authorization is not configured.");
  const supplied = request.headers.get("x-gateway-secret") ?? "";
  const encoder = new TextEncoder();
  const left = encoder.encode(supplied);
  const right = encoder.encode(expected);
  if (request.headers.get("x-gateway-caller") !== "team-2-gateway" ||
      left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new HttpError(403, "Use the main gateway to access this function.");
  }
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function safeError(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 503;
  console.error("Edge request failed.", { kind: error instanceof Error ? error.name : "unknown", status });
  return json({ error: error instanceof HttpError ? error.message : "The service could not complete this request. Check its logs." }, status);
}

let sql: ReturnType<typeof postgres> | undefined;
export function db(): ReturnType<typeof postgres> {
  if (!sql) {
    const ca = Deno.env.get("EDGE_DATABASE_CA");
    sql = postgres(env("EDGE_DATABASE_URL"), {
      max: 2, prepare: false, connect_timeout: 10, idle_timeout: 10,
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      connection: { statement_timeout: 20000, lock_timeout: 10000 },
    });
  }
  return sql;
}

let mongo: Promise<MongoClient> | undefined;
export async function mongoCollection(databaseName?: string | null, collectionName?: string | null): Promise<Collection<Document>> {
  if (!mongo) {
    const client = new MongoClient(env("MONGODB_URI"), {
      maxPoolSize: 2, serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 20000,
    });
    mongo = client.connect().catch(async (error: unknown) => {
      mongo = undefined;
      await client.close();
      throw error;
    });
  }
  const client = await mongo;
  return client.db(databaseName?.trim() || Deno.env.get("MONGODB_DATABASE")?.trim() || "hackathon-opportunity-research")
    .collection(collectionName?.trim() || Deno.env.get("MONGODB_COLLECTION")?.trim() || "hackathons");
}

export function functionPath(request: Request, name: string): string {
  let path = new URL(request.url).pathname;
  const prefix = `/functions/v1/${name}`;
  if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  else if (path === `/${name}` || path.startsWith(`/${name}/`)) path = path.slice(name.length + 1);
  return path || "/";
}

export async function readJson(request: Request, maxBytes = 8192): Promise<unknown> {
  if (!request.body) throw new HttpError(400, "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, `Request body exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, "Enter valid JSON."); }
}
