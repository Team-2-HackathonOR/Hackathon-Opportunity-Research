function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function notify(message, error = false) {
  $("#notification").textContent = message;
  $("#notification").classList.toggle("error", error);
}

function signOut() {
  authenticated = false;
  queueController?.abort();
  clearTimeout(searchTimer);
  clearTimeout(pipelineTimer);
  clearInterval(pipelineClock);
  pipelineJob = null;
  $("#pipeline-progress").hidden = true;
  scraping = false;
  $("#scraper-run").disabled = false;
  submissions = [];
  selectedSubmission = null;
  $("#dashboard").hidden = true;
  $("#review-panel").hidden = true;
  $("#login-panel").hidden = false;
  $("#logout").hidden = true;
  $("#account-email").textContent = "";
  $("#password").value = "";
  $("#scraper-api-key").value = "";
  $("#scraper-result").textContent = "";
  setLoginStep("email");
}

async function api(route, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api/hackscout/admin/${route}`, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "x-hackscout-admin": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  let payload;
  try {
    const text = await response.text();
    if (!text.trim()) throw new Error("The admin API returned an empty response.");
    payload = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`The admin API returned invalid JSON (HTTP ${response.status}).`);
    }
    throw error;
  }
  if (!response.ok) {
    if (authenticated && (response.status === 401 || response.status === 403)) signOut();
    throw new Error(payload.error || `Admin API returned HTTP ${response.status}.`);
  }
  return payload;
}
