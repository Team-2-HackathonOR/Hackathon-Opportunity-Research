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
