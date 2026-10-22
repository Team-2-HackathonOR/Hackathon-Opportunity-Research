import { describe, expect, it } from "vitest";

import { formatReadableLogLine } from "./logger.js";

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
