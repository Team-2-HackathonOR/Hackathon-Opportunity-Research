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
