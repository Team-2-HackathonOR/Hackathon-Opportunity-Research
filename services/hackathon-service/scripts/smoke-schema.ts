process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54329/hackathons";
process.env.DATABASE_SSL = "false";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";

const { buildApp } = await import("../src/app.js");
const { closeDatabaseConnection } = await import("../src/db/client.js");

const app = await buildApp();
const failures: string[] = [];

function check(name: string, status: number, expected: number, body: string) {
  if (status !== expected) {
    failures.push(`${name}: expected ${expected}, got ${status} ${body}`);
  }
}

const created = await app.inject({
  method: "POST",
  url: "/api/hackathons",
  payload: {
    event_name: "PayPal AI Hackathon",
    organizer_name: "PayPal",
    format: "virtual",
    event_start_date: "2026-10-01",
    event_end_date: "2026-11-12",
    official_website: "https://paypalaihackathon.devpost.com/",
    operational_status: "verified_apply_now",
    evidence_confidence: "high",
    lodging_support: "application_based",
  },
});
check("create", created.statusCode, 201, created.body);
const eventId = created.json().data?.event_id as number;

const duplicate = await app.inject({
  method: "POST",
  url: "/api/hackathons",
  payload: {
    event_name: "PayPal AI Hackathon",
    event_start_date: "2026-10-01",
    operational_status: "monitor",
    evidence_confidence: "low",
  },
});
check("duplicate identity", duplicate.statusCode, 409, duplicate.body);

const badDates = await app.inject({
  method: "POST",
  url: "/api/hackathons",
  payload: {
    event_name: "Date Check",
    event_start_date: "2026-11-01",
    event_end_date: "2026-10-01",
    operational_status: "needs_confirmation",
    evidence_confidence: "low",
  },
});
check("date check", badDates.statusCode, 400, badDates.body);

const shortlist = await app.inject({
  method: "PUT",
  url: `/api/hackathons/${eventId}/shortlist`,
  payload: {
    queue_type: "apply_now",
    why_practical: "Virtual event with open registration and a relevant payments API.",
  },
});
check("shortlist", shortlist.statusCode, 200, shortlist.body);

const applyNow = await app.inject({ method: "GET", url: "/api/hackathons/views/apply-now" });
check("apply now view", applyNow.statusCode, 200, applyNow.body);
const applyRows = applyNow.json().data as Array<{ event_id: number; why_practical: string }>;
if (!applyRows.some((row) => row.event_id === eventId && row.why_practical.includes("payments"))) {
  failures.push(`apply now view missing shortlisted event: ${applyNow.body}`);
}

const source = await app.inject({
  method: "POST",
  url: `/api/hackathons/${eventId}/sources`,
  payload: {
    source_type: "official_site",
    source_url: "https://paypalaihackathon.devpost.com/",
    source_title: "Official Devpost page",
  },
});
check("source", source.statusCode, 201, source.body);

const evidence = await app.inject({ method: "GET", url: "/api/hackathons/views/evidence" });
check("evidence view", evidence.statusCode, 200, evidence.body);
if (!(evidence.json().data as Array<{ source_url: string }>).some((row) => row.source_url.includes("paypal"))) {
  failures.push(`evidence view missing source: ${evidence.body}`);
}

const draftAnswer = await app.inject({
  method: "POST",
  url: "/api/organizer-followups",
  payload: {
    event_id: eventId,
    question_text: "Is lodging reimbursed?",
    response_status: "draft",
    confirmed_answer: "Yes",
  },
});
check("draft answer", draftAnswer.statusCode, 400, draftAnswer.body);

const followup = await app.inject({
  method: "POST",
  url: "/api/organizer-followups",
  payload: {
    event_id: eventId,
    question_text: "Is lodging reimbursed?",
    response_status: "responded",
    confirmed_answer: "Application based.",
  },
});
check("follow-up", followup.statusCode, 201, followup.body);

const travel = await app.inject({ method: "GET", url: "/api/hackathons/views/travel-supported" });
check("travel view", travel.statusCode, 200, travel.body);
if (!(travel.json().data as Array<{ event_id: number }>).some((row) => row.event_id === eventId)) {
  failures.push(`travel view missing lodging support: ${travel.body}`);
}

const milestone = await app.inject({
  method: "POST",
  url: `/api/hackathons/${eventId}/milestones`,
  payload: {
    milestone_type: "registration_deadline",
    milestone_name: "Submission deadline",
    due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
});
check("milestone", milestone.statusCode, 201, milestone.body);

const deadlines = await app.inject({
  method: "GET",
  url: "/api/hackathons/views/deadlines?withinDays=7",
});
check("deadlines", deadlines.statusCode, 200, deadlines.body);
if (deadlines.json().view !== "v_deadlines_next_7_days") {
  failures.push(`deadline route did not use the 7-day view: ${deadlines.body}`);
}

await app.close();
await closeDatabaseConnection();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("schema smoke test passed");
