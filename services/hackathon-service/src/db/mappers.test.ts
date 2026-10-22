import { describe, expect, it } from "vitest";

import { toApiRecord, toEventInsert } from "./mappers.js";

describe("research mappers", () => {
  it("writes events columns, not the retired flat hackathon columns", () => {
    const insert = toEventInsert({
      event_name: "PayPal AI Hackathon",
      organizer_name: "PayPal",
      operational_status: "verified_apply_now",
      evidence_confidence: "high",
      format: "virtual",
      registration_fee_amount: 0,
      registration_fee_currency: "USD",
      travel_support: "not_confirmed",
    });

    expect(insert.eventName).toBe("PayPal AI Hackathon");
    expect(insert.organizerName).toBe("PayPal");
    expect(insert.operationalStatus).toBe("verified_apply_now");
    expect(insert.evidenceConfidence).toBe("high");
    expect(insert.registrationFeeAmount).toBe("0.00");
    expect(Object.keys(insert)).not.toContain("status");
    expect(Object.keys(insert)).not.toContain("isShortlisted");
    expect(Object.keys(insert)).not.toContain("researcherName");
  });

  it("returns snake_case column names", () => {
    expect(
      toApiRecord({
        eventId: 2,
        eventName: "PayPal AI Hackathon",
        registrationDeadlineAt: "2026-11-12T20:00:00.000Z",
      }),
    ).toEqual({
      event_id: 2,
      event_name: "PayPal AI Hackathon",
      registration_deadline_at: "2026-11-12T20:00:00.000Z",
    });
  });
});
