$("#submission-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review]");
  if (button && !reviewing) openReview(button.dataset.review);
});
$("#status-filter").addEventListener("change", () => { page = 1; closeReview(); loadQueue(); });
$("#submission-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  queueController?.abort();
  searchTimer = setTimeout(() => { page = 1; closeReview(); loadQueue(); }, 250);
});
$("#refresh").addEventListener("click", () => { closeReview(); loadQueue(); });
$("#previous").addEventListener("click", () => { page -= 1; closeReview(); loadQueue(); });
$("#next").addEventListener("click", () => { page += 1; closeReview(); loadQueue(); });
$("#close-review").addEventListener("click", closeReview);
$("#review-form").addEventListener("submit", (event) => { event.preventDefault(); review("approved"); });
$("#reject").addEventListener("click", () => review("rejected"));

async function restoreAdminSession() {
  $("#login-submit").disabled = true;
  try {
    const response = await fetch("/api/hackscout/admin/auth/session", { credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) return;
    if (!response.ok) throw new Error(`Could not restore administrator session (HTTP ${response.status}).`);
    await openDashboard(await response.json());
  } catch (error) {
    console.error("Could not restore administrator session:", error);
    notify(error.message, true);
  } finally {
    $("#login-submit").disabled = false;
  }
}
void restoreAdminSession();
