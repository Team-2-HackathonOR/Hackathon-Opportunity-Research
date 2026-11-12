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
