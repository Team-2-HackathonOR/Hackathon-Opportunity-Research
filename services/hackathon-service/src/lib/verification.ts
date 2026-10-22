export type EventConstraintInput = {
  event_id?: number | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  team_size_min?: number | null;
  team_size_max?: number | null;
  registration_fee_amount?: number | string | null;
  registration_fee_currency?: string | null;
  duplicate_of_event_id?: number | null;
};

export function assertEventConstraints(payload: EventConstraintInput): void {
  if (
    payload.event_start_date &&
    payload.event_end_date &&
    payload.event_end_date < payload.event_start_date
  ) {
    throw new Error("event_end_date must be on or after event_start_date.");
  }

  if (
    payload.team_size_min != null &&
    payload.team_size_max != null &&
    payload.team_size_max < payload.team_size_min
  ) {
    throw new Error("team_size_max must be greater than or equal to team_size_min.");
  }

  if (payload.registration_fee_amount != null && Number(payload.registration_fee_amount) < 0) {
    throw new Error("registration_fee_amount must be zero or greater.");
  }

  if (
    payload.registration_fee_currency != null &&
    !/^[A-Z]{3}$/.test(payload.registration_fee_currency)
  ) {
    throw new Error("registration_fee_currency must be a three-letter uppercase code.");
  }

  if (
    payload.event_id != null &&
    payload.duplicate_of_event_id != null &&
    payload.event_id === payload.duplicate_of_event_id
  ) {
    throw new Error("An event cannot be marked as a duplicate of itself.");
  }
}

export function assertFollowupRules(payload: {
  response_status?: string | null;
  confirmed_answer?: string | null;
}): void {
  const answer = payload.confirmed_answer?.trim() ?? "";
  if ((payload.response_status ?? "draft") === "draft" && answer.length > 0) {
    throw new Error("Cannot store confirmed_answer while response_status is draft.");
  }
}

export type IdentityInput = {
  event_name: string;
  event_start_date?: string | null;
  city?: string | null;
  country?: string | null;
};

/** Same key as uq_events_master_identity: name, start date, city, country. */
export function eventIdentityKey(input: IdentityInput): string {
  return [
    input.event_name,
    input.event_start_date ?? "1900-01-01",
    input.city ?? "",
    input.country ?? "",
  ].join("\u0000");
}
