import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, expect, it, vi } from "vitest";

import { createServiceLogStream, formatReadableLogLine } from "./logger.js";

describe("Vercel logging", () => {
  it("ignores file logging with a warning and keeps stdout logging", async () => {
    vi.stubEnv("VERCEL", "1");
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const directory = join(tmpdir(), `hackathon-log-test-${crypto.randomUUID()}`);
    let output = "";
    try {
      const stream = createServiceLogStream({
        nodeEnv: "production",
        logFilePath: join(directory, "service.log"),
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            output += chunk.toString();
            callback();
          },
        }),
      });
      const record = '{"level":30,"msg":"test log"}\n';
      stream.end(record);
      await finished(stream);
      expect(output).toBe(record);
      expect(existsSync(directory)).toBe(false);
      expect(warning).toHaveBeenCalledWith(
        "LOG_FILE_PATH is ignored on Vercel; service logs are written to stdout.\n",
      );
    } finally {
      warning.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("formatReadableLogLine", () => {
  it("turns one JSON record into a line a person can read", () => {
    const line = formatReadableLogLine(
      JSON.stringify({
        level: 30,
        time: Date.parse("2026-10-19T12:00:00.000Z"),
        service: "hackathon-service",
        method: "POST",
        path: "/api/hackathons",
        statusCode: 201,
        responseTimeMs: 12,
        requestId: "req-1",
        msg: "hackathon-service request completed",
      }),
    );

    expect(line).toContain("INFO");
    expect(line).toContain("service=hackathon-service");
    expect(line).toContain("POST");
    expect(line).toContain("/api/hackathons");
    expect(line).toContain("201");
    expect(line).toContain("id=req-1");
  });
});
