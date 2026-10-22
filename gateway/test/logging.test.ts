import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createServiceLogStream, formatReadableLogLine } from "../src/lib/logger.js";
import { createGatewayApp } from "./create-gateway-app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function captureStream(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () => chunks.join("").split(/\n/).filter((line) => line.trim().length > 0),
  };
}

describe("request logging", () => {
  it("writes a structured line for each request", async () => {
    const captured = captureStream();
    app = await createGatewayApp({ LOG_LEVEL: "info" }, { logStream: captured.stream });

    const response = await app.inject({
      method: "GET",
      url: "/health?ignored=1",
      headers: { "x-forwarded-for": "203.0.113.8" },
    });

    expect(response.statusCode).toBe(200);

    const records = captured
      .lines()
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.msg === "gateway request completed");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      method: "GET",
      path: "/health",
      statusCode: 200,
      service: "team-2-gateway",
      ip: "203.0.113.8",
    });
    expect(typeof records[0]?.requestId).toBe("string");
    expect(typeof records[0]?.responseTimeMs).toBe("number");
  }, 20_000);

  it("records admin block actions without the admin key", async () => {
    const captured = captureStream();
    app = await createGatewayApp(
      { LOG_LEVEL: "info", ADMIN_API_KEY: "secret-key" },
      { logStream: captured.stream },
    );

    const response = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-ip",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "secret-key",
      },
      payload: JSON.stringify({ ip: "203.0.113.9" }),
    });

    expect(response.statusCode).toBe(200);
    const text = captured.lines().join("\n");
    expect(text).toContain("admin blocked ip");
    expect(text).toContain("203.0.113.9");
    expect(text).not.toContain("secret-key");
  }, 20_000);

  it("logs validation failures", async () => {
    const captured = captureStream();
    app = await createGatewayApp(
      { LOG_LEVEL: "info", ADMIN_API_KEY: "secret-key" },
      { logStream: captured.stream },
    );

    const response = await app.inject({
      method: "POST",
      url: "/admin/access-control/block-path",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "secret-key",
      },
      payload: JSON.stringify({}),
    });

    expect(response.statusCode).toBe(400);
    const messages = captured
      .lines()
      .map((line) => JSON.parse(line) as { msg?: string })
      .map((record) => record.msg);
    expect(messages).toContain("validation failed");
  }, 20_000);
});

describe("formatReadableLogLine", () => {
  it("turns one JSON record into a line a person can read", () => {
    const line = formatReadableLogLine(
      JSON.stringify({
        level: 30,
        time: Date.parse("2026-10-19T12:00:00.000Z"),
        service: "team-2-gateway",
        method: "GET",
        path: "/health",
        statusCode: 200,
        responseTimeMs: 4,
        requestId: "abc",
        msg: "gateway request completed",
      }),
    );

    expect(line).toContain("INFO");
    expect(line).toContain("service=team-2-gateway");
    expect(line).toContain("GET");
    expect(line).toContain("/health");
    expect(line).toContain("200");
    expect(line).toContain("4ms");
    expect(line).toContain("id=abc");
    expect(line).toContain("gateway request completed");
  });
});

describe("createServiceLogStream", () => {
  it("appends JSON to the log file and to stdout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gateway-logs-"));
    const logFilePath = join(directory, "gateway.log");
    const stdoutChunks: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      },
    });

    const stream = createServiceLogStream({
      nodeEnv: "production",
      logFilePath,
      stdout,
    });
    const record = `${JSON.stringify({ level: 30, msg: "gateway listening", service: "team-2-gateway" })}\n`;

    await new Promise<void>((resolve, reject) => {
      stream.write(record, (error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      stream.end((error: Error | null | undefined) => (error ? reject(error) : resolve()));
    });

    expect(readFileSync(logFilePath, "utf8")).toContain("gateway listening");
    expect(stdoutChunks.join("")).toContain("gateway listening");
  });
});
