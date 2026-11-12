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
