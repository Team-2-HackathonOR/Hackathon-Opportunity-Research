import { describe, expect, it } from "vitest";

import { assertEventConstraints, assertFollowupRules, eventIdentityKey } from "./verification.js";

describe("eventIdentityKey", () => {
  it("uses the same coalesce rules as uq_events_master_identity", () => {
    expect(
      eventIdentityKey({
        event_name: "OpenCV AI Competition 2026",
        event_start_date: null,
        city: null,
        country: null,
      }),
    ).toBe(eventIdentityKey({ event_name: "OpenCV AI Competition 2026" }));

    expect(
      eventIdentityKey({
        event_name: "OpenCV AI Competition 2026",
        event_start_date: "2026-08-26",
        city: "Austin",
        country: "USA",
      }),
    ).not.toBe(eventIdentityKey({ event_name: "OpenCV AI Competition 2026" }));
  });
});

describe("assertEventConstraints", () => {
  it("allows a verified low-confidence row when the table checks pass", () => {
    expect(() =>
      assertEventConstraints({
        event_start_date: "2026-08-26",
        event_end_date: "2026-10-26",
        registration_fee_currency: "USD",
      }),
    ).not.toThrow();
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      assertEventConstraints({
        event_start_date: "2026-10-26",
        event_end_date: "2026-08-26",
      }),
    ).toThrow(/event_end_date/);
  });

  it("rejects a team max below the team min", () => {
    expect(() => assertEventConstraints({ team_size_min: 4, team_size_max: 2 })).toThrow(/team_size_max/);
  });

  it("rejects a self duplicate", () => {
    expect(() => assertEventConstraints({ event_id: 3, duplicate_of_event_id: 3 })).toThrow(/duplicate of itself/);
  });
});

describe("assertFollowupRules", () => {
  it("blocks a confirmed answer while the follow-up is a draft", () => {
    expect(() => assertFollowupRules({ response_status: "draft", confirmed_answer: "yes" })).toThrow(/draft/);
  });

  it("allows a confirmed answer after a response", () => {
    expect(() =>
      assertFollowupRules({ response_status: "responded", confirmed_answer: "Travel is covered." }),
    ).not.toThrow();
  });
});
