import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { Writable, type Writable as WritableStream } from "node:stream";

import type { FastifyReply, FastifyRequest, FastifyServerOptions } from "fastify";

const LEVEL_LABELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

export const logRedact = {
  paths: [
    "req.headers.authorization",
    'req.headers["x-admin-key"]',
    'req.headers["x-api-key"]',
    'req.headers["x-gateway-secret"]',
    "req.body.password",
  ],
  remove: true,
};

export function formatReadableLogLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const record = JSON.parse(trimmed) as Record<string, unknown>;
    const time =
      typeof record.time === "number" ? new Date(record.time).toISOString() : new Date().toISOString();
    const level = LEVEL_LABELS[Number(record.level)] ?? "INFO";
    const service = typeof record.service === "string" ? ` service=${record.service}` : "";
    const method = typeof record.method === "string" ? ` ${record.method}` : "";
    const path = typeof record.path === "string" ? ` ${record.path}` : "";
    const status = typeof record.statusCode === "number" ? ` ${record.statusCode}` : "";
    const duration = typeof record.responseTimeMs === "number" ? ` ${record.responseTimeMs}ms` : "";
    const requestId = typeof record.requestId === "string" ? ` id=${record.requestId}` : "";
    const msg = typeof record.msg === "string" ? ` ${record.msg}` : "";
    return `${time} ${level}${service}${method}${path}${status}${duration}${requestId}${msg}\n`;
  } catch {
    return line.endsWith("\n") ? line : `${line}\n`;
  }
}

export function createServiceLogStream(options: {
  nodeEnv: "development" | "production" | "test";
  logFilePath?: string;
  stdout?: WritableStream;
}): Writable {
  const stdout = options.stdout ?? process.stdout;
  const file = openLogFile(options.logFilePath);
  const readable = options.nodeEnv === "development";

  return new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      writeStdout(stdout, text, readable);
      if (!file) {
        callback();
        return;
      }
      file.write(text, callback);
    },
    final(callback) {
      if (!file) {
        callback();
        return;
      }
      file.end(callback);
    },
  });
}

export function buildFastifyLogger(options: {
  level: string;
  nodeEnv: "development" | "production" | "test";
  serviceName: string;
  logFilePath?: string;
  stream?: Writable;
}): FastifyServerOptions["logger"] {
  if (!options.stream && options.nodeEnv === "test") {
    return false;
  }

  return {
    level: options.level as "info",
    stream:
      options.stream ??
      createServiceLogStream({
        nodeEnv: options.nodeEnv,
        logFilePath: options.logFilePath,
      }),
    redact: logRedact,
    base: { service: options.serviceName },
  };
}

export function logCompletedRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  serviceName: string,
  message: string,
): void {
  const path = request.url.split("?")[0] ?? request.url;
  request.log.info(
    {
      requestId: request.id,
      method: request.method,
      path,
      statusCode: reply.statusCode,
      responseTimeMs: Math.round(reply.elapsedTime),
      ip: clientAddress(request),
      service: serviceName,
    },
    message,
  );
}

function clientAddress(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || request.ip;
  }
  return request.ip;
}

function writeStdout(stdout: WritableStream, text: string, readable: boolean): void {
  if (!readable) {
    stdout.write(text);
    return;
  }

  for (const line of text.split(/\n/)) {
    if (!line) {
      continue;
    }
    stdout.write(formatReadableLogLine(line));
  }
}

function openLogFile(logFilePath: string | undefined): WriteStream | undefined {
  if (!logFilePath) {
    return undefined;
  }

  mkdirSync(dirname(logFilePath), { recursive: true });
  const file = createWriteStream(logFilePath, { flags: "a" });
  file.on("error", (error) => {
    process.stderr.write(`Failed to write log file ${logFilePath}: ${error.message}\n`);
  });
  return file;
}
