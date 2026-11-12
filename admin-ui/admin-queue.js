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
