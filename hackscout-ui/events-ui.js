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
