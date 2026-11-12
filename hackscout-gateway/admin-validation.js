class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, name, max, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new AdminError(400, `Enter a valid ${name} (maximum ${max} characters).`);
  }
  return value.trim();
}

function website(value, name, required = false) {
  const result = text(value, name, 2048, required);
  if (!result) return "";
  let url;
  try {
    url = new URL(result);
  } catch {
    throw new AdminError(400, `Enter a valid ${name}.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AdminError(400, `Enter an HTTP or HTTPS ${name} without embedded credentials.`);
  }
  return result;
}

function date(value, name, required = false) {
  const result = text(value, name, 10, required);
  if (!result) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) {
    throw new AdminError(400, `Enter a valid ${name}.`);
  }
  return result;
}

function moderationBody(body) {
  if (!body || !["approved", "rejected"].includes(body.decision)) {
    throw new AdminError(400, "Choose approve or reject.");
  }
  const notes = text(body.notes, "review note", 2000, body.decision === "rejected");
  if (body.decision === "rejected") return { decision: body.decision, notes, event: {} };
  const source = body.event;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AdminError(400, "Event details are required before publishing.");
  }
  if (!["in_person", "virtual", "hybrid"].includes(source.format)) {
    throw new AdminError(400, "Choose in-person, virtual, or hybrid.");
  }
  const event = {
    event_name: text(source.event_name, "event name", 160, true),
    organizer_name: text(source.organizer_name, "organizer", 160, true),
    official_website: website(source.official_website, "official website", true),
    registration_link: website(source.registration_link, "registration link"),
    format: source.format,
    event_start_date: date(source.event_start_date, "start date", true),
    event_end_date: date(source.event_end_date, "end date"),
    city: text(source.city, "city", 160),
    country: text(source.country, "country", 160),
    description: text(source.description, "event description", 4000, true),
    technical_tracks: text(source.technical_tracks, "topics", 1000),
    registration_fee_notes: text(source.registration_fee_notes, "fee details", 500),
  };
  if (event.event_end_date && event.event_end_date < event.event_start_date) {
    throw new AdminError(400, "The end date cannot precede the start date.");
  }
  if (event.format !== "virtual" && (!event.city || !event.country)) {
    throw new AdminError(400, "City and country are required for in-person and hybrid events.");
  }
  return { decision: body.decision, notes, event };
}

module.exports = { AdminError, moderationBody, text };
