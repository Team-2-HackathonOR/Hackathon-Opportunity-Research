let events = [];
let listingsLoading = true;
let listingsError = false;
const saved = new Set();
let savedStorageKey = "hackscout-saved:guest";
let listingsComplete = false;
let activeCategory = "All";
let savedOnly = false;
const pageSize = 6;
let currentPage = 1;
let showMoreCategories = false;
let searchSuggestions = [];
let matchingSuggestions = [];
let activeSuggestion = -1;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function formatDate(iso, options = { month: "short", day: "numeric" }) {
  if (!iso) return "Date TBD";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", options);
}
function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}
function classifyEligibility(value, affirmative, negative) {
  if (negative.test(value || "")) return "no";
  if (affirmative.test(value || "")) return "yes";
  return "unknown";
}
function mapServiceListing(row) {
  const tracks = row.tracks || [];
  const benefits = row.benefits || [];
  const requirements = row.requirements || [];
  const sources = row.sources || [];
  const awards = benefits.filter(({ benefit_type }) => ["prize", "sponsor_prize"].includes(benefit_type));
  const otherBenefits = benefits.filter(({ benefit_type }) => !["prize", "sponsor_prize"].includes(benefit_type));
  const statusLabels = {
    verified_apply_now: "Verified - Apply Now",
    verified_registration_upcoming: "Verified - Registration Upcoming",
    monitor: "Monitor",
    needs_confirmation: "Needs Confirmation",
    not_eligible: "Not Eligible",
    closed_expired: "Closed/Expired",
    rejected_unreliable: "Rejected as Unreliable"
  };
  const teamSize = row.team_size_min == null && row.team_size_max == null
    ? row.solo_participation_policy
    : `${row.team_size_min ?? "?"}-${row.team_size_max ?? "?"}`;
  const displayEnum = (value) => value ? String(value).replaceAll("_", " ") : value;
  const fee = [
    row.registration_fee_amount == null
      ? ""
      : `${row.registration_fee_amount}${row.registration_fee_currency ? ` ${row.registration_fee_currency.trim()}` : ""}`,
    row.registration_fee_notes
  ].filter(Boolean).join(" — ");
  return {
    id: row.event_id,
    event_name: row.event_name,
    organizer: row.organizer_name,
    official_website: row.official_website,
    registration_link: row.registration_link,
    rules_faq_url: row.rules_faq_link,
    city: row.city,
    state_region: row.state_region,
    country: row.country,
    venue: row.venue,
    format: row.format,
    event_start: row.event_start_date,
    event_end: row.event_end_date,
    registration_deadline: row.registration_deadline_at,
    registration_status: row.registration_status,
    last_verified_date: row.last_verified_at,
    student_eligibility: row.student_eligibility,
    outside_school_eligibility: row.outside_school_eligibility,
    international_student_wording: row.international_student_wording,
    age_rules: row.age_rules,
    team_size: teamSize,
    solo_team_formation_rules: [
      row.solo_participation_policy,
      row.team_formation_rules,
      row.all_members_must_register == null
        ? ""
        : row.all_members_must_register ? "All team members must register." : "Not all team members must register."
    ].filter(Boolean).join(" "),
    registration_fee: fee,
    travel_support: displayEnum(row.travel_support),
    lodging: displayEnum(row.lodging_support),
    meals: displayEnum(row.meals_support),
    reimbursement_conditions: row.reimbursement_conditions,
    technical_tracks: tracks.map(({ track_name, description }) => [track_name, description].filter(Boolean).join(": ")).join("; "),
    ai_policy: row.ai_tool_policy,
    pre_existing_code_policy: row.pre_existing_code_policy,
    ip_terms: row.intellectual_property_terms,
    application_requirements: [
      row.application_requirements,
      ...requirements.map(({ requirement_text }) => requirement_text)
    ].filter(Boolean).join("; "),
    prizes: awards.map(({ title, description, award_value }) =>
      [title, description, award_value].filter(Boolean).join(" — ")).join("; "),
    sponsor_recruiting_benefits: otherBenefits.map(({ title, description }) =>
      [title, description].filter(Boolean).join(" — ")).join("; "),
    evidence_links: sources.map(({ source_url, source_title }) => ({
      url: source_url,
      label: source_title
    })),
    status: statusLabels[row.operational_status] || String(row.operational_status || "").replaceAll("_", " "),
    confidence: row.evidence_confidence
      ? row.evidence_confidence[0].toUpperCase() + row.evidence_confidence.slice(1)
      : ""
  };
}
function mapHackathon(row) {
  const tracks = row.technical_tracks || "";
  const categorySource = [
    row.event_name,
    tracks,
    row.ai_policy,
    row.prizes,
    row.sponsor_recruiting_benefits,
    row.application_requirements
  ].filter(Boolean).join(" ");
  const categoryRules = [
    { name: "AI", pattern: /\b(ai|artificial intelligence|machine learning|data science|data analytics|data visualization|predictive analytics|natural language processing|computer vision)\b/i, art: "art-ai" },
    { name: "VR/AR", pattern: /\b(vr|virtual reality|augmented reality|mixed reality|extended reality|xr)\b/i, art: "art-vr" },
    { name: "Climate", pattern: /\b(climate|sustainability|sustainable|clean energy|renewable energy|environment|environmental|conservation|water quality|agriculture)\b/i, art: "art-climate" },
    { name: "Health", pattern: /\b(health|healthcare|medical|wellness|biotech|biomedical|public health|patient|disease|fitness)\b/i, art: "art-health" },
    { name: "Gaming", pattern: /\b(gaming|games?|video game|game development|game design|interactive game)\b/i, art: "art-gaming" },
    { name: "Social impact", pattern: /\b(social impact|social good|civic|community|communities|accessibility|public service|underserved|nonprofit|justice)\b/i, art: "art-civic" },
    { name: "Web3", pattern: /\b(web3|blockchain|crypto|decentralized)\b/i, art: "art-web" },
    { name: "Cybersecurity", pattern: /\b(cybersecurity|cyber security|information security|data protection|privacy|fraud prevention)\b/i, art: "art-security" },
    { name: "Education", pattern: /\b(education|educational|learning|edtech|classroom|curriculum|literacy|teaching)\b/i, art: "art-education" },
    { name: "Fintech", pattern: /\b(fintech|finance|financial|payments|banking|insurance)\b/i, art: "art-fintech" },
    { name: "Robotics & hardware", pattern: /\b(robotics|robot|hardware|embedded systems|iot|internet of things|sensors?|wearables?|connected devices?)\b/i, art: "art-hardware" },
    { name: "Apps & software", pattern: /\b(app development|application development|mobile apps?|software development|web development|app challenge)\b/i, art: "art-software" },
    { name: "Science & research", pattern: /\b(science|scientific|research|laboratory|laboratories|clinical research)\b/i, art: "art-science" },
    { name: "Transportation", pattern: /\b(transportation|mobility|vehicles?|transit|automotive|traffic|commuting|railway)\b/i, art: "art-transport" },
    { name: "Productivity & work", pattern: /\b(productivity|workflow|workplace|business process|entrepreneurship)\b/i, art: "art-work" }
  ];
  const category = categoryRules.filter(({ pattern }) => pattern.test(categorySource)).map(({ name }) => name);
  const date = row.event_start ? String(row.event_start).slice(0, 10) : null;
  const format = ({ in_person: "In-person", virtual: "Virtual", hybrid: "Hybrid" })[row.format] || "Not confirmed";
  const location = row.format === "virtual" ? "Online" :
    [row.venue, row.city, row.state_region, row.country].filter(Boolean).join(", ") || "Location not confirmed";
  const fee = row.registration_fee || "";
  const cost = /\bfree|no fee|no cost\b/i.test(fee) ? "Free" :
    /\b(paid|fee required|registration fee|usd|\$)\b/i.test(fee) ? "Paid" : "Not confirmed";
  const teamSize = row.team_size || "";
  const teamRange = teamSize.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  const soloTeam = /\bsolo\b/i.test(teamSize);
  const rulesFaqUrl = row.rules_faq_url || "";
  const studentEligibility = classifyEligibility(
    row.student_eligibility,
    /\b(required|must be|students only|only students)\b/i,
    /\b(not required|no student requirement|non[- ]students|open to all|anyone may)\b/i
  );
  const student = studentEligibility === "yes" ? "required" :
    studentEligibility === "no" ? "not-required" : "unknown";
  const outsideUniversity = classifyEligibility(
    row.outside_school_eligibility,
    /\b(allowed|eligible|open to|accepted)\b/i,
    /\b(not allowed|ineligible|not eligible|university students only|school students only)\b/i
  );
  const international = classifyEligibility(
    row.international_student_wording,
    /\b(allowed|eligible|open to|accepted)\b/i,
    /\b(not allowed|ineligible|not eligible|cannot participate|not accepted)\b/i
  );
  const officialWebsite = row.official_website || "";
  const registrationLink = row.registration_link || "";
  return {
    id: String(row.id),
    title: row.event_name,
    organizer: row.organizer || "Organizer not listed",
    topic: tracks.split(/[,;\n]/).map((part) => part.trim()).find(Boolean) || "Hackathon",
    category,
    date,
    endDate: dateOnly(row.event_end) || date,
    location,
    format,
    cost,
    mark: (category[0] || "H").slice(0, 3).toUpperCase(),
    art: categoryRules.find(({ pattern }) => pattern.test(categorySource))?.art || "art-general",
    label: row.status || "Hackathon listing",
    beginner: /\b(beginner|first[- ]time|new to hackathons)\b/i.test(`${tracks} ${row.application_requirements || ""}`),
    student,
    undergraduate: "unknown",
    outsideUniversity: outsideUniversity === "yes" || outsideUniversity === "no" ? outsideUniversity : "unknown",
    international: international === "yes" || international === "no" ? international : "unknown",
    age: null,
    geography: [row.country, row.outside_school_eligibility, row.international_student_wording].filter(Boolean).join(" ") || "Needs confirmation",
    invitation: "unknown",
    teamMin: soloTeam ? 1 : teamRange ? Number(teamRange[1]) : null,
    teamMax: soloTeam ? 1 : teamRange ? Number(teamRange[2]) : null,
    solo: soloTeam ? "yes" : teamRange && Number(teamRange[1]) > 1 ? "no" : "unknown",
    teamFormation: "unknown",
    allMembersRegister: "unknown",
    description: tracks || row.application_requirements || "See the official event website for details.",
    officialWebsite,
    registrationLink,
    rulesFaqUrl,
    status: row.status,
    confidence: row.confidence,
    details: [
      ["Event dates", row.event_start && row.event_end ? `${dateOnly(row.event_start)} to ${dateOnly(row.event_end)}` : dateOnly(row.event_start || row.event_end)],
      ["Registration deadline", dateOnly(row.registration_deadline)],
      ["Registration status", row.registration_status],
      ["Last verified", dateOnly(row.last_verified_date)],
      ["Student eligibility", row.student_eligibility],
      ["Outside-school eligibility", row.outside_school_eligibility],
      ["International student wording", row.international_student_wording],
      ["Age rules", row.age_rules],
      ["Team size", row.team_size],
      ["Solo/team rules", row.solo_team_formation_rules],
      ["Registration fee", row.registration_fee],
      ["Travel support", row.travel_support],
      ["Lodging", row.lodging],
      ["Meals", row.meals],
      ["Reimbursement conditions", row.reimbursement_conditions],
      ["Technical tracks", row.technical_tracks],
      ["AI policy", row.ai_policy],
      ["Pre-existing code policy", row.pre_existing_code_policy],
      ["IP terms", row.ip_terms],
      ["Judging criteria", row.judging_criteria],
      ["Prizes", row.prizes],
      ["Sponsor/recruiting benefits", row.sponsor_recruiting_benefits],
      ["Application requirements", row.application_requirements]
    ].filter(([, value]) => value)
  };
}
function updateSavedCount() {
  $("#saved-count").textContent = saved.size;
}
function persistSaved() {
  localStorage.setItem(savedStorageKey, JSON.stringify([...saved]));
}
function savedDataError(error) {
  console.error("Could not update saved hackathons:", error);
  $("#saved-feedback").textContent = "Could not read or update saved hackathons in this browser. Check browser storage permissions or clear browser data.";
}
function pruneSavedHackathons() {
  if (!listingsComplete) return;
  const existing = new Set(events.map((event) => event.id));
  const removed = [...saved].filter((id) => !existing.has(id));
  if (!removed.length) return;
  for (const id of removed) saved.delete(id);
  try { persistSaved(); } catch (error) { savedDataError(error); }
}
function setHackScoutSavedAccount(user = null) {
  savedStorageKey = user ? `hackscout-saved:user:${user.id}` : "hackscout-saved:guest";
  saved.clear();
  $("#saved-feedback").textContent = "";
  try {
    const stored = JSON.parse(localStorage.getItem(savedStorageKey) || "[]");
    if (!Array.isArray(stored) || stored.some((id) =>
      (typeof id !== "string" && typeof id !== "number") || !/^[1-9]\d*$/.test(String(id)))) {
      throw new Error("Saved hackathons have an invalid format.");
    }
    for (const id of stored) saved.add(String(id));
    pruneSavedHackathons();
  } catch (error) { savedDataError(error); }
  savedOnly = false;
  closeModal();
  renderEvents();
}
function clearHackScoutBrowserData() {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === "hackscout-saved" || key === "hackscout-saved:guest" || key?.startsWith("hackscout-saved:user:")) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  saved.clear();
  $("#saved-feedback").textContent = "";
  clearFilters();
}
function eligibilityMatches(event) {
  const student = $("#student-filter").value;
  const undergraduate = $("#undergrad-filter").value;
  const outsideUniversity = $("#outside-school-filter").value;
  const international = $("#international-filter").value;
  const ageRule = $("#age-filter").value;
  const myAge = $("#my-age-filter").value === "" ? null : Number($("#my-age-filter").value);
  const geography = $("#geography-filter").value.trim().toLowerCase();
  const invitation = $("#invitation-filter").value;
  const teamSize = $("#team-size-filter").value === "" ? null : Number($("#team-size-filter").value);
  const participation = $("#participation-filter").value;
  const teamFormation = $("#team-formation-filter").value;
  const membersRegister = $("#members-register-filter").value;
  const triState = (selected, actual) => !selected || actual === selected;

  if (myAge !== null && (!Number.isInteger(myAge) || myAge < 1 || myAge > 120)) return false;
  if (!triState(student, event.student)) return false;
  if (!triState(undergraduate, event.undergraduate)) return false;
  if (!triState(outsideUniversity, event.outsideUniversity)) return false;
  if (!triState(international, event.international)) return false;
  if (!triState(invitation, event.invitation)) return false;
  if (!triState(teamFormation, event.teamFormation)) return false;
  if (!triState(membersRegister, event.allMembersRegister)) return false;
  if (ageRule === "unknown" && event.age !== null) return false;
  if (ageRule === "none" && (!event.age || event.age.min !== null || event.age.max !== null)) return false;
  if (ageRule === "restricted" && (!event.age || (event.age.min === null && event.age.max === null))) return false;
  if (myAge !== null && (!event.age || (event.age.min !== null && myAge < event.age.min) || (event.age.max !== null && myAge > event.age.max))) return false;
  if (geography && !event.geography.toLowerCase().includes(geography) && !/worldwide|global/i.test(event.geography)) return false;
  if (teamSize !== null && (event.teamMin === null || event.teamMax === null || teamSize < event.teamMin || teamSize > event.teamMax)) return false;
  if (participation === "solo" && event.solo !== "yes") return false;
  if (participation === "team" && (event.solo !== "no" || event.teamMin === null || event.teamMin < 2)) return false;
  return true;
}
function getFilteredEvents() {
  const keyword = $("#keyword-input").value.trim().toLowerCase();
  const location = $("#location-input").value.trim().toLowerCase();
  const selectedDate = $("#date-input").value;
  const format = $("#format-filter").value;
  const cost = $("#cost-filter").value;
  const withinDays = Number($("#when-filter").value);
  const includeClosed = $("#include-closed").checked;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = events.filter((event) => {
    const searchableDetails = event.details.map(([, value]) => value).join(" ");
    const haystack = `${event.title} ${event.organizer} ${event.topic} ${event.location} ${event.format} ${event.cost} ${event.category.join(" ")} ${searchableDetails}`.toLowerCase();
    const eventDate = event.date ? new Date(`${event.date}T00:00:00`) : null;
    const daysUntil = eventDate ? (eventDate - today) / 86400000 : Infinity;
    const categoryMatches = activeCategory === "All" ||
      (activeCategory === "Beginner" ? event.beginner : event.category.some((category) => category.toLowerCase() === activeCategory.toLowerCase()));
    const locationMatches = !location || event.location.toLowerCase().includes(location) ||
      (["online", "virtual", "remote"].some((word) => location.includes(word)) && event.format === "Virtual");
    return (includeClosed || event.status !== "Closed/Expired") &&
      keyword.split(/\s+/).every((term) => haystack.includes(term)) && locationMatches && categoryMatches &&
      (!format || event.format === format) && (!cost || event.cost === cost) &&
      (!selectedDate || (event.date && event.date <= selectedDate && event.endDate >= selectedDate)) &&
      (!withinDays || (daysUntil >= 0 && daysUntil <= withinDays)) && (!savedOnly || saved.has(event.id)) &&
      eligibilityMatches(event);
  });
  const sort = $("#sort-select").value;
  result.sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title);
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    return sort === "latest" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  return result;
}
function renderEvents({ keepPage = false } = {}) {
  if (!keepPage) currentPage = 1;
  const filtered = getFilteredEvents();
  const grid = $("#event-grid");
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * pageSize;
  const shown = filtered.slice(start, start + pageSize);
  grid.innerHTML = shown.map((event) => `
    <article class="event-card ${event.art}">
      <div class="card-art ${event.art}">
        <span class="event-illustration" aria-hidden="true"></span><span class="art-label">${escapeHtml(event.label)}</span>
        <button class="save-button ${saved.has(event.id) ? "saved" : ""}" data-save="${event.id}" aria-label="${saved.has(event.id) ? "Remove saved event" : "Save event"}">${saved.has(event.id) ? "♥" : "♡"}</button>
      </div>
      <div class="card-body">
        <div class="card-tags"><span class="event-topic">${escapeHtml(event.category[0] || event.topic)}</span><span class="sample-tag">${escapeHtml(event.status || "Listing")}</span></div>
        <h4 class="card-title">${escapeHtml(event.title)}</h4><div class="card-organizer">${escapeHtml(event.organizer)}</div><div class="eligibility-quick">${event.student === "required" ? "Student status required" : event.student === "not-required" ? "Student status not required" : "Student status: needs confirmation"}</div>
        <div class="card-meta"><span class="meta-item"><span>▦</span>${event.date ? formatDate(event.date, { month: "short", day: "numeric" }) : "Date TBD"}</span><span class="meta-item"><span>⌖</span>${escapeHtml(event.location)}</span></div>
        <div class="card-bottom"><span class="format-badge">${escapeHtml(event.format)} · ${escapeHtml(event.cost)}</span><button class="card-detail" data-details="${event.id}" aria-label="View details for ${escapeHtml(event.title)}" aria-haspopup="dialog" aria-controls="event-modal">Event details <span>→</span></button></div>
      </div>
    </article>`).join("");
  $("#no-results").hidden = listingsLoading || listingsError || filtered.length > 0;
  grid.hidden = listingsLoading || listingsError || filtered.length === 0;
  $("#pagination").hidden = listingsLoading || listingsError || filtered.length === 0;
  $("#previous-page").disabled = currentPage === 1;
  $("#next-page").disabled = currentPage === pageCount;
  $("#page-select").innerHTML = Array.from({ length: pageCount }, (_, index) =>
    `<option value="${index + 1}" ${index + 1 === currentPage ? "selected" : ""}>${index + 1}</option>`).join("");
  $("#page-status").textContent = `of ${pageCount} · ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} events`;
  $("#results-title").innerHTML = `${savedOnly ? "Saved events" : "Hackathon listings"} <span id="result-count">(${filtered.length})</span>`;
  $("#results-description").textContent = savedOnly
    ? "Your saved events, all in one place."
    : "Search all listings, including closed events. Uncheck Include closed to hide archived opportunities.";
  const closedCount = events.filter((event) => event.status === "Closed/Expired").length;
  $("#closed-count").textContent = closedCount ? `(${closedCount})` : "";
  const filterIds = ["format-filter", "when-filter", "cost-filter", "student-filter", "undergrad-filter", "outside-school-filter", "international-filter", "age-filter", "my-age-filter", "geography-filter", "invitation-filter", "team-size-filter", "participation-filter", "team-formation-filter", "members-register-filter"];
  const activeCount = filterIds.reduce((total, id) => total + Number(Boolean($(`#${id}`).value)), 0);
  $("#filter-count").textContent = activeCount ? `(${activeCount})` : "";
  $$(".save-button").forEach((button) => button.addEventListener("click", () => toggleSaved(button.dataset.save)));
  $$(".card-detail").forEach((button) => button.addEventListener("click", () => showEventDetails(button.dataset.details)));
  updateSavedCount();
}
function toggleSaved(id) {
  if (!events.some((event) => event.id === id)) return;
  const wasSaved = saved.has(id);
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  try {
    persistSaved();
    $("#saved-feedback").textContent = "";
  } catch (error) {
    if (wasSaved) saved.add(id);
    else saved.delete(id);
    savedDataError(error);
  }
  renderEvents({ keepPage: true });
}
function showEventDetails(id) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  const registrationUrl = safeExternalUrl(event.registrationLink) || safeExternalUrl(event.officialWebsite);
  const officialUrl = safeExternalUrl(event.officialWebsite);
  const rulesUrl = safeExternalUrl(event.rulesFaqUrl);
  $("#modal-content").innerHTML = `
    <div class="modal-art ${event.art}"><span class="event-illustration" aria-hidden="true"></span><span class="art-label">${escapeHtml(event.label)}</span></div>
    <div class="card-tags"><span class="event-topic">${escapeHtml(event.category[0] || event.topic)}</span><span class="sample-tag">${escapeHtml(event.status || "Listing")}</span></div>
    <h2 class="modal-title" id="modal-title">${escapeHtml(event.title)}</h2><p class="modal-organizer">${escapeHtml(event.organizer)}</p>
    <div class="modal-facts"><div class="modal-fact"><small>Event date</small><strong>${event.date ? formatDate(event.date, { month: "long", day: "numeric", year: "numeric" }) : "Date not confirmed"}</strong></div><div class="modal-fact"><small>Location</small><strong>${escapeHtml(event.location)}</strong></div><div class="modal-fact"><small>Format</small><strong>${escapeHtml(event.format)}</strong></div><div class="modal-fact"><small>Registration cost</small><strong>${escapeHtml(event.cost)}</strong></div><div class="modal-fact"><small>Confidence</small><strong>${escapeHtml(event.confidence || "Not provided")}</strong></div></div>
    <p class="modal-description">${escapeHtml(event.description)}</p>
    <h3 class="eligibility-heading">Event details <span>${escapeHtml(event.status || "Status not provided")}</span></h3>
    <div class="eligibility-details">${event.details.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
    ${officialUrl ? `<p class="modal-description"><a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">Official event website</a></p>` : ""}
    ${rulesUrl ? `<p class="modal-description"><a href="${escapeHtml(rulesUrl)}" target="_blank" rel="noopener noreferrer">Rules and FAQ</a></p>` : ""}
    <div class="modal-disclaimer">Details are provided by the event research database. Confirm eligibility and deadlines with the organizer before applying.</div>
    <div class="modal-actions"><button class="modal-save ${saved.has(event.id) ? "saved" : ""}" id="modal-save">${saved.has(event.id) ? "Saved" : "Save event"}</button>${registrationUrl ? `<a class="modal-apply" href="${escapeHtml(registrationUrl)}" target="_blank" rel="noopener noreferrer">Visit event & register</a>` : `<button class="modal-apply" disabled title="No event link is available">Event link unavailable</button>`}</div>`;
  $("#event-modal").classList.add("open");
  $("#event-modal").setAttribute("aria-hidden", "false");
  $("#modal-save").addEventListener("click", () => {
    toggleSaved(event.id);
    showEventDetails(event.id);
  });
}
function closeModal() {
  $("#event-modal").classList.remove("open");
  $("#event-modal").setAttribute("aria-hidden", "true");
}
function closeSearchSuggestions() {
  $("#search-suggestions").hidden = true;
  $("#keyword-input").setAttribute("aria-expanded", "false");
  $("#keyword-input").removeAttribute("aria-activedescendant");
  activeSuggestion = -1;
}
function updateSearchSuggestions() {
  const query = $("#keyword-input").value.trim().toLowerCase();
  if (!query) {
    closeSearchSuggestions();
    return;
  }
  const terms = query.split(/\s+/);
  matchingSuggestions = searchSuggestions.filter((value) =>
    terms.every((term) => value.toLowerCase().includes(term))).slice(0, 8);
  activeSuggestion = -1;
  $("#keyword-input").removeAttribute("aria-activedescendant");
  $("#search-suggestions").innerHTML = matchingSuggestions.length
    ? matchingSuggestions.map((value, index) =>
      `<li id="search-option-${index}" role="option" aria-selected="false" data-suggestion="${index}">${escapeHtml(value)}</li>`).join("")
    : '<li role="presentation" class="suggestion-empty">No suggestions. Try another keyword.</li>';
  $("#search-suggestions").hidden = false;
  $("#keyword-input").setAttribute("aria-expanded", "true");
}
function selectSearchSuggestion(index) {
  $("#keyword-input").value = matchingSuggestions[index];
  savedOnly = false;
  closeSearchSuggestions();
  renderEvents();
}
function clearFilters() {
  $("#keyword-input").value = "";
  $("#location-input").value = "";
  $("#date-input").value = "";
  closeSearchSuggestions();
  $("#format-filter").value = "";
  $("#when-filter").value = "";
  $("#cost-filter").value = "";
  $("#include-closed").checked = true;
  ["student-filter", "undergrad-filter", "outside-school-filter", "international-filter", "age-filter", "my-age-filter", "geography-filter", "invitation-filter", "team-size-filter", "participation-filter", "team-formation-filter", "members-register-filter"].forEach((id) => { $(`#${id}`).value = ""; });
  activeCategory = "All";
  savedOnly = false;
  $$(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === "All"));
  renderEvents();
}
async function loadHackathons() {
  listingsComplete = false;
  try {
    const rows = [];
    const seen = new Set();
    let afterId = 0;
    while (true) {
      const response = await fetch(`/api/hackscout/hackathons?limit=100&include=details&after_event_id=${afterId}`);
      if (!response.ok) throw new Error(`Listings API returned HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) throw new Error("Listings API response was not a list");
      for (const row of payload.data) {
        const id = String(row.event_id);
        if (!/^[1-9]\d*$/.test(id) || seen.has(id)) throw new Error("Listings API returned invalid or repeated event IDs");
        seen.add(id);
        rows.push(row);
      }
      if (!Object.hasOwn(payload, "next_after_id")) {
        // Older services cannot prove completeness when a page reaches the limit.
        listingsComplete = payload.data.length < 100;
        break;
      }
      if (payload.next_after_id === null) { listingsComplete = true; break; }
      if (!Number.isSafeInteger(payload.next_after_id) || payload.next_after_id <= afterId || !payload.data.length) {
        throw new Error("Listings API pagination did not advance");
      }
      afterId = payload.next_after_id;
    }
    events = rows.map((row) => mapHackathon(mapServiceListing(row)));
    pruneSavedHackathons();
    searchSuggestions = [...new Set(events.flatMap((event) =>
      [event.title, event.organizer, event.location, ...event.category]))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (document.activeElement === $("#keyword-input")) updateSearchSuggestions();
    listingsLoading = false;
    listingsError = false;
    $("#listing-notice").textContent = `Showing ${events.length} live listings from the team database. Confirm event details with organizers.`;
  } catch (error) {
    console.error("Could not load hackathon listings:", error);
    listingsLoading = false;
    listingsError = true;
    $("#listing-notice").textContent = "Could not load live hackathon listings. Check the main gateway, Hackathon Service, and its database connection.";
  }
  renderEvents();
}
function setTopic(topic) {
  savedOnly = false;
  const knownCategory = [...$$(".category-chip")].some((chip) => chip.dataset.category.toLowerCase() === topic.toLowerCase());
  activeCategory = knownCategory ? [...$$(".category-chip")].find((chip) => chip.dataset.category.toLowerCase() === topic.toLowerCase()).dataset.category : "All";
  $("#keyword-input").value = knownCategory ? "" : topic;
  closeSearchSuggestions();
  $$(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === activeCategory));
  currentPage = 1;
  renderEvents();
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  closeSearchSuggestions();
  savedOnly = false;
  currentPage = 1;
  renderEvents();
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#keyword-input").addEventListener("input", () => {
  savedOnly = false;
  updateSearchSuggestions();
  renderEvents();
});
$("#keyword-input").addEventListener("focus", updateSearchSuggestions);
$("#keyword-input").addEventListener("blur", closeSearchSuggestions);
$("#keyword-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSearchSuggestions();
    return;
  }
  if (event.key === "Enter" && !$("#search-suggestions").hidden && activeSuggestion >= 0) {
    event.preventDefault();
    selectSearchSuggestion(activeSuggestion);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  if ($("#search-suggestions").hidden) updateSearchSuggestions();
  if (!matchingSuggestions.length || $("#search-suggestions").hidden) return;
  activeSuggestion = event.key === "ArrowDown"
    ? (activeSuggestion + 1) % matchingSuggestions.length
    : (activeSuggestion <= 0 ? matchingSuggestions.length : activeSuggestion) - 1;
  $$("#search-suggestions [role='option']").forEach((option, index) =>
    option.setAttribute("aria-selected", String(index === activeSuggestion)));
  const option = $(`#search-option-${activeSuggestion}`);
  $("#keyword-input").setAttribute("aria-activedescendant", option.id);
  option.scrollIntoView({ block: "nearest" });
});
$("#search-suggestions").addEventListener("mousedown", (event) => event.preventDefault());
$("#search-suggestions").addEventListener("click", (event) => {
  const option = event.target.closest("[data-suggestion]");
  if (option) selectSearchSuggestion(Number(option.dataset.suggestion));
});
$("#date-input").addEventListener("change", () => { savedOnly = false; renderEvents(); });
$("#location-input").addEventListener("input", () => { savedOnly = false; renderEvents(); });
$("#online-toggle").addEventListener("click", () => { $("#location-input").value = "Online"; savedOnly = false; renderEvents(); });
$("#sort-select").addEventListener("change", renderEvents);
$("#include-closed").addEventListener("change", () => {
  renderEvents();
});
["format-filter", "when-filter", "cost-filter", "student-filter", "undergrad-filter", "outside-school-filter", "international-filter", "age-filter", "my-age-filter", "geography-filter", "invitation-filter", "team-size-filter", "participation-filter", "team-formation-filter", "members-register-filter"].forEach((id) => {
  const control = $(`#${id}`);
  control.addEventListener(control.tagName === "INPUT" ? "input" : "change", renderEvents);
});
$("#filters-toggle").addEventListener("click", () => {
  const isOpen = $("#filter-panel").classList.toggle("open");
  $("#filters-toggle").setAttribute("aria-expanded", String(isOpen));
});
$("#clear-filters").addEventListener("click", clearFilters);
$("#reset-search").addEventListener("click", clearFilters);
function goToPage(page) {
  currentPage = page;
  renderEvents({ keepPage: true });
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#previous-page").addEventListener("click", () => goToPage(currentPage - 1));
$("#next-page").addEventListener("click", () => goToPage(currentPage + 1));
$("#page-select").addEventListener("change", (event) => goToPage(Number(event.target.value)));
$$(".category-chip").forEach((button) => button.addEventListener("click", () => {
  activeCategory = button.dataset.category;
  savedOnly = false;
  currentPage = 1;
  $$(".category-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderEvents();
}));
$$(".popular-tag").forEach((button) => button.addEventListener("click", () => setTopic(button.dataset.topic)));
$$("[data-quick-filter]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  $("#format-filter").value = "Virtual";
  savedOnly = false;
  renderEvents();
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
}));
$("#saved-nav").addEventListener("click", () => {
  savedOnly = !savedOnly;
  activeCategory = "All";
  $$(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === "All"));
  renderEvents();
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#saved-link").addEventListener("click", (event) => {
  event.preventDefault();
  savedOnly = true;
  renderEvents();
  $("#events").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#more-categories").addEventListener("click", () => {
  if (!showMoreCategories) {
    const extraCategories = [
      ["Web3", "◇"],
      ["Cybersecurity", "⌑"],
      ["Education", "✎"],
      ["Fintech", "$"],
      ["Robotics & hardware", "⚙"],
      ["Apps & software", "⌘"],
      ["Science & research", "⚗"],
      ["Transportation", "↗"],
      ["Productivity & work", "▤"],
      ["Beginner", "✦"]
    ];
    const more = $("#more-categories");
    extraCategories.forEach(([name, icon]) => {
      const button = document.createElement("button");
      button.className = "category-chip";
      button.dataset.category = name;
      button.innerHTML = `<span>${icon}</span> ${name === "Beginner" ? "Beginner-friendly" : name}`;
      button.addEventListener("click", () => setTopic(name));
      more.before(button);
    });
    more.innerHTML = "Fewer topics <span>⌃</span>";
  } else {
    $$(".category-chip").forEach((chip) => {
      if (["Web3", "Cybersecurity", "Education", "Fintech", "Robotics & hardware", "Apps & software", "Science & research", "Transportation", "Productivity & work", "Beginner"].includes(chip.dataset.category)) chip.remove();
    });
    $("#more-categories").innerHTML = "More topics <span>⌄</span>";
  }
  showMoreCategories = !showMoreCategories;
});
$("#mobile-nav-toggle").addEventListener("click", () => $(".main-nav").classList.toggle("open"));
$("#modal-close").addEventListener("click", closeModal);
$("#event-modal").addEventListener("click", (event) => { if (event.target.id === "event-modal") closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
$("#suggest-event").addEventListener("click", () => {
  $("#modal-content").innerHTML = `<span class="eyebrow">COMMUNITY SUBMISSION</span><h2 class="modal-title" id="modal-title">Suggest an event</h2><p class="modal-organizer">Suggestions are sent for review and won’t appear in listings automatically.</p><form id="suggest-form" class="suggest-form"><label>Event name<input required maxlength="160" name="event" placeholder="Name of the hackathon" /></label><label>Official event website<input required type="url" maxlength="2048" name="website" placeholder="https://" /></label><button class="modal-apply" type="submit">Send suggestion</button><p class="suggest-feedback" id="suggest-feedback" aria-live="polite"></p></form>`;
  $("#event-modal").classList.add("open");
  $("#event-modal").setAttribute("aria-hidden", "false");
  $("#suggest-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const feedback = $("#suggest-feedback");
    const formData = new FormData(form);
    submitButton.disabled = true;
    feedback.textContent = "Sending your suggestion…";
    try {
      const response = await fetch("/api/hackscout/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: formData.get("event"),
          website: formData.get("website")
        })
      });
      if (!response.ok) throw new Error(`Suggestion API returned HTTP ${response.status}`);
      feedback.textContent = "Thanks! Your suggestion has been sent for review.";
      form.reset();
    } catch (error) {
      console.error("Could not send event suggestion:", error);
      feedback.textContent = "Could not send your suggestion. Please try again later.";
    } finally {
      submitButton.disabled = false;
    }
  });
});

renderEvents();
setHackScoutSavedAccount();
loadHackathons();
