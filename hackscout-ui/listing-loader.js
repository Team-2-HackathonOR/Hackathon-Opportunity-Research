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
