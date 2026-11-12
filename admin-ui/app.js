const $ = (selector) => document.querySelector(selector);
let token = "";
let page = 1;
let total = 0;
let pageSize = 12;
let submissions = [];
let selectedSubmission = null;
let loading = false;
let reviewing = false;
let scraping = false;
let pipelineTimer;
let pipelineClock;
let pipelineJob = null;
let queueController = null;
let searchTimer;

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
  token = "";
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
}

async function api(route, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api/hackscout/admin/${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (response.status === 401 || response.status === 403) signOut();
    throw new Error(payload.error || `Admin API returned HTTP ${response.status}.`);
  }
  return payload;
}

function renderQueue() {
  $("#submission-list").innerHTML = submissions.length ? submissions.map((submission) => {
    const url = externalUrl(submission.website);
    return `<tr><td><div class="event-name">${escapeHtml(submission.event_name)}</div>${url
      ? `<a class="event-website" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(submission.website)}</a>`
      : '<span class="event-website">Invalid website - do not publish without verification.</span>'}</td>
      <td>${escapeHtml(new Date(submission.submitted_at).toLocaleString())}</td>
      <td><span class="badge ${["pending", "approved", "rejected"].includes(submission.status) ? submission.status : ""}">${escapeHtml(submission.status)}</span></td>
      <td><button class="secondary" data-review="${escapeHtml(submission.id)}">${submission.status === "pending" ? "Review" : "View review"}</button></td></tr>`;
  }).join("") : '<tr><td colspan="4">No submissions match this status or search.</td></tr>';
  $("#queue-count").textContent = `${total} matching submissions`;
  $("#page-status").textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`;
  $("#previous").disabled = loading || reviewing || page <= 1;
  $("#next").disabled = loading || reviewing || page * pageSize >= total;
}

async function loadQueue() {
  queueController?.abort();
  const controller = new AbortController();
  queueController = controller;
  loading = true;
  $("#refresh").disabled = true;
  $("#previous").disabled = true;
  $("#next").disabled = true;
  $("#submission-list").innerHTML = '<tr><td colspan="4">Loading submissions...</td></tr>';
  try {
    const query = new URLSearchParams({
      status: $("#status-filter").value,
      search: $("#submission-search").value.trim(),
      page: String(page),
    });
    const result = await api(`suggestions?${query}`, { signal: controller.signal });
    if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0) {
      throw new Error("The admin API returned an invalid queue.");
    }
    submissions = result.items;
    total = result.total;
    pageSize = result.pageSize;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) {
      page = lastPage;
      return await loadQueue();
    }
    loading = false;
    renderQueue();
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Could not load moderation queue:", error);
    notify(error.message, true);
    $("#submission-list").innerHTML = '<tr><td colspan="4">The queue could not be loaded. Refresh to try again.</td></tr>';
    $("#queue-count").textContent = "";
    $("#page-status").textContent = "";
  } finally {
    if (queueController === controller) {
      loading = false;
      $("#refresh").disabled = reviewing;
    }
  }
}

function closeReview() {
  selectedSubmission = null;
  $("#review-panel").hidden = true;
}

function openReview(id) {
  const submission = submissions.find((item) => String(item.id) === id);
  if (!submission) return;
  selectedSubmission = submission;
  $("#review-title").textContent = submission.event_name;
  $("#submission-details").textContent = `Submission #${submission.id} - ${submission.status} - received ${new Date(submission.submitted_at).toLocaleString()}`;
  const link = $("#submitted-website");
  const url = externalUrl(submission.website);
  link.hidden = !url;
  if (url) link.href = url;
  else link.removeAttribute("href");
  $("#review-form").reset();
  $("#review-form").elements.namedItem("event_name").value = submission.event_name;
  $("#review-form").elements.namedItem("official_website").value = url;
  $("#review-form").hidden = submission.status !== "pending";
  $("#review-history").hidden = submission.status === "pending";
  $("#review-history").textContent = `Reviewed: ${submission.reviewed_at ? new Date(submission.reviewed_at).toLocaleString() : "Not recorded"}\nReviewer: ${submission.reviewed_by || "Not recorded"}\nNote: ${submission.review_notes || "No review note"}${submission.published_event_id ? `\nPublished event ID: ${submission.published_event_id}` : ""}`;
  $("#review-panel").hidden = false;
  $("#review-title").focus();
  $("#review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setReviewing(value) {
  reviewing = value;
  for (const selector of ["#approve", "#reject", "#close-review", "#refresh", "#status-filter", "#submission-search", "#logout"]) {
    $(selector).disabled = value;
  }
  $("#review-form").querySelectorAll("input,select,textarea").forEach((control) => { control.disabled = value; });
  $("#previous").disabled = value || loading || page <= 1;
  $("#next").disabled = value || loading || page * pageSize >= total;
  $("#submission-list").querySelectorAll("button").forEach((button) => { button.disabled = value; });
}

async function review(decision) {
  if (!selectedSubmission || reviewing) return;
  const notes = $("#review-notes").value.trim();
  if (decision === "rejected" && !notes) {
    notify("Add a review note explaining why this submission is rejected.", true);
    $("#review-notes").focus();
    return;
  }
  const event = Object.fromEntries(new FormData($("#review-form")));
  setReviewing(true);
  notify(decision === "approved" ? "Publishing the approved event..." : "Rejecting submission...");
  try {
    const result = await api(`suggestions/${selectedSubmission.id}/review`, {
      method: "POST", body: { decision, notes, event },
    });
    notify(decision === "approved"
      ? `Submission approved. Event #${result.published_event_id} is now published as Needs Confirmation.`
      : "Submission rejected. The review note has been saved.");
    closeReview();
    await loadQueue();
  } catch (error) {
    console.error("Could not moderate submission:", error);
    notify(error.message, true);
  } finally {
    setReviewing(false);
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-submit").disabled = true;
  notify("Signing in...");
  try {
    const session = await api("login", {
      method: "POST", body: { email: $("#email").value.trim(), password: $("#password").value },
    });
    if (!session.token || session.user?.role !== "admin") throw new Error("An administrator account is required.");
    token = session.token;
    $("#password").value = "";
    $("#account-email").textContent = session.user.email;
    $("#login-panel").hidden = true;
    $("#dashboard").hidden = false;
    $("#logout").hidden = false;
    page = 1;
    notify("Signed in. Select a submission to review.");
    await loadPipeline();
    await loadPipelineSchedule();
    await loadQueue();
  } catch (error) {
    console.error("Admin sign-in failed:", error);
    notify(error.message, true);
  } finally {
    $("#login-submit").disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  $("#logout").disabled = true;
  try {
    await api("logout", { method: "POST", body: {} });
    notify("Signed out.");
  } catch (error) {
    console.error("Could not revoke admin session:", error);
    notify(`Signed out locally, but session revocation failed: ${error.message}`, true);
  } finally {
    signOut();
    $("#logout").disabled = false;
  }
});

function pipelineElapsed(startedAt, finishedAt) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor(((finishedAt ? Date.parse(finishedAt) : Date.now()) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function updatePipelineClock() {
  if (!pipelineJob) return;
  for (const stage of ["scraper", "etl"]) {
    const step = pipelineJob.steps?.[stage];
    $(`#pipeline-time-${stage}`).textContent = step?.startedAt
      ? pipelineElapsed(step.startedAt, step.finishedAt) : "--:--";
  }
  $("#pipeline-time-total").textContent = pipelineElapsed(pipelineJob.startedAt, pipelineJob.finishedAt);
}

function showPipeline(job) {
  clearInterval(pipelineClock);
  pipelineJob = job;
  scraping = job?.status === "running";
  $("#scraper-run").disabled = scraping;
  $("#pipeline-progress").hidden = !job;
  $("#scraper-result").classList.toggle("error", job?.status === "failed");
  if (!job) {
    $("#scraper-result").textContent = "";
    return;
  }
  for (const stage of ["scraper", "etl"]) {
    const status = job.steps?.[stage]?.status || "waiting";
    $(`#pipeline-step-${stage}`).dataset.status = status;
    $(`#pipeline-step-${stage} .pipeline-marker`).textContent = status === "completed" ? "OK"
      : status === "failed" ? "!" : stage === "scraper" ? "1" : "2";
    $(`#pipeline-status-${stage}`).textContent = {
      running: "Running", completed: "Completed", failed: "Failed", skipped: "Skipped", waiting: "Waiting",
    }[status] || "Waiting";
  }
  updatePipelineClock();
  if (scraping) pipelineClock = setInterval(updatePipelineClock, 1000);
  const scrape = job.scraper
    ? `Scraper: ${job.scraper.pagesPersisted} pages, ${job.scraper.uniqueHackathonsPersisted} unique records. ` : "";
  const etl = job.etl
    ? `ETL: ${job.etl.processed} processed, ${job.etl.inserted} inserted, ${job.etl.failed} failed. ` : "";
  $("#scraper-result").textContent = scraping
    ? `${scrape}Running ${job.stage}. You can leave this page; the server continues the run.`
    : `${scrape}${etl}${job.status === "completed" ? "Pipeline completed." : `Pipeline failed at ${job.stage}: ${job.error}`}`;
}

async function loadPipeline() {
  clearTimeout(pipelineTimer);
  try {
    const result = await api("pipeline");
    if (!token) return;
    showPipeline(result.job);
    await loadPipelineSchedule(false);
    if (token) pipelineTimer = setTimeout(loadPipeline, scraping ? 3000 : 10000);
  } catch (error) {
    console.error("Could not load pipeline status:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not check pipeline status: ${error.message}`;
    if (token) pipelineTimer = setTimeout(loadPipeline, 5000);
  }
}

function showPipelineSchedule(schedule, updateSelection = true) {
  if (updateSelection) $("#pipeline-frequency").value = schedule.frequency;
  const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString(undefined, {
    timeZone: schedule.timeZone, dateStyle: "medium", timeStyle: "short",
  }) : null;
  $("#pipeline-schedule-status").classList.toggle("error", !!schedule.lastError);
  $("#pipeline-schedule-status").textContent = schedule.lastError ||
    (next ? `Next run: ${next} (${schedule.timeZone}).` : "Automatic runs are disabled.") +
    (schedule.keyConfigured ? "" : " Configure AI_API_KEY on the backend to enable a schedule.");
}

async function loadPipelineSchedule(updateSelection = true) {
  try {
    const result = await api("pipeline/schedule");
    if (token) showPipelineSchedule(result.schedule, updateSelection);
  } catch (error) {
    console.error("Could not load pipeline schedule:", error);
    $("#pipeline-schedule-status").classList.add("error");
    $("#pipeline-schedule-status").textContent = error.message;
  }
}

$("#pipeline-schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#pipeline-schedule-save").disabled = true;
  try {
    const result = await api("pipeline/schedule", {
      method: "POST", body: { frequency: $("#pipeline-frequency").value },
    });
    if (token) showPipelineSchedule(result.schedule);
  } catch (error) {
    console.error("Could not save pipeline schedule:", error);
    $("#pipeline-schedule-status").classList.add("error");
    $("#pipeline-schedule-status").textContent = error.message;
  } finally {
    $("#pipeline-schedule-save").disabled = false;
  }
});

$("#scraper-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (scraping) return;
  scraping = true;
  $("#scraper-run").disabled = true;
  $("#scraper-result").classList.remove("error");
  $("#scraper-result").textContent = "Starting the scraper and ETL pipeline...";
  clearTimeout(pipelineTimer);
  clearInterval(pipelineClock);
  pipelineJob = null;
  $("#pipeline-progress").hidden = true;
  try {
    const request = api("pipeline/run", {
      method: "POST",
      body: { apiKey: $("#scraper-api-key").value.trim() },
    });
    $("#scraper-api-key").value = "";
    const result = await request;
    if (!token) return;
    showPipeline(result.job);
    if (scraping && token) pipelineTimer = setTimeout(loadPipeline, 3000);
  } catch (error) {
    console.error("Could not start pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = error.message;
    scraping = false;
    $("#scraper-run").disabled = false;
  } finally {
    $("#scraper-api-key").value = "";
  }
});
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
