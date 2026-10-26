import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, expect, it, vi } from "vitest";

import { createServiceLogStream } from "../src/lib/logger.js";

describe("Vercel logging", () => {
  it("ignores file logging with a warning and keeps stdout logging", async () => {
    vi.stubEnv("VERCEL", "1");
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const directory = join(tmpdir(), `jwt-log-test-${crypto.randomUUID()}`);
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
