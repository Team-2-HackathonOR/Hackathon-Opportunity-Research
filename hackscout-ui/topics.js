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
