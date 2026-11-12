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
