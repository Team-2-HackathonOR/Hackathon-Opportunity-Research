type PgErrorFields = {
  code?: string;
  constraint?: string;
  cause?: unknown;
};

const UNIQUE_MESSAGES: Record<string, string> = {
  uq_events_master_identity:
    "An event with this name, start date, city, and country already exists.",
  uq_event_source: "This source URL is already recorded for the event.",
  event_categories_category_name_key: "That category name already exists.",
  team_members_email_key: "A team member with this email already exists.",
};

const CHECK_MESSAGES: Record<string, string> = {
  chk_event_dates: "event_end_date must be on or after event_start_date.",
  chk_team_size: "team_size_max must be greater than or equal to team_size_min.",
  chk_fee_amount: "registration_fee_amount must be zero or greater.",
  chk_currency_code: "registration_fee_currency must be a three-letter uppercase code.",
  chk_not_self_duplicate: "An event cannot be marked as a duplicate of itself.",
  chk_hours_spent: "hours_spent must be zero or greater.",
};

function asPgError(error: unknown): PgErrorFields | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as PgErrorFields;
  if (typeof candidate.code === "string") {
    return candidate;
  }

  if (candidate.cause !== undefined) {
    return asPgError(candidate.cause);
  }

  return undefined;
}

export function mapDatabaseError(error: unknown): { statusCode: number; error: string } | undefined {
  const pgError = asPgError(error);
  if (!pgError?.code) {
    return undefined;
  }

  if (pgError.code === "23505") {
    const message =
      (pgError.constraint && UNIQUE_MESSAGES[pgError.constraint]) || "Duplicate record.";
    return { statusCode: 409, error: message };
  }

  if (pgError.code === "23514") {
    const message =
      (pgError.constraint && CHECK_MESSAGES[pgError.constraint]) || "Record violates a database rule.";
    return { statusCode: 400, error: message };
  }

  if (pgError.code === "23503") {
    return { statusCode: 400, error: "Referenced record does not exist." };
  }

  if (pgError.code === "23502") {
    return { statusCode: 400, error: "A required field is missing." };
  }

  if (pgError.code === "22P02") {
    return { statusCode: 400, error: "Value is not one of the allowed options." };
  }

  return undefined;
}
