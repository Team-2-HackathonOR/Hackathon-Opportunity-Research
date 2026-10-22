import { describe, expect, it } from "vitest";

import { mapDatabaseError } from "./pg-errors.js";

describe("mapDatabaseError", () => {
  it("maps the event identity unique index to 409", () => {
    expect(mapDatabaseError({ code: "23505", constraint: "uq_events_master_identity" })).toEqual({
      statusCode: 409,
      error: "An event with this name, start date, city, and country already exists.",
    });
  });

  it("maps a wrapped date check to 400", () => {
    const error = {
      message: "query failed",
      cause: { code: "23514", constraint: "chk_event_dates" },
    };

    expect(mapDatabaseError(error)?.statusCode).toBe(400);
    expect(mapDatabaseError(error)?.error).toMatch(/event_end_date/);
  });

  it("maps a missing foreign key to 400", () => {
    expect(mapDatabaseError({ code: "23503" })?.error).toMatch(/does not exist/);
  });
});
