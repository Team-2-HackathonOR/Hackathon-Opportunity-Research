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
  for (const stage of ["reset", "scraper", "etl"]) {
    const step = pipelineJob.steps?.[stage];
    $(`#pipeline-time-${stage}`).textContent = step?.startedAt
      ? pipelineElapsed(step.startedAt, step.finishedAt) : "--:--";
  }
  $("#pipeline-time-total").textContent = pipelineElapsed(pipelineJob.startedAt, pipelineJob.finishedAt);
}

function showPipeline(job) {
  const cleared = pipelineJob?.purpose === "clear" && !job;
  clearInterval(pipelineClock);
  pipelineJob = job;
  scraping = job?.status === "running" || job?.status === "queued";
  $("#scraper-run").disabled = scraping || stoppingPipeline;
  $("#pipeline-stop").hidden = false;
  $("#pipeline-stop").disabled = !scraping || stoppingPipeline;
  $("#pipeline-stop").title = scraping ? "Stop this run and disable automatic runs."
    : "No queued or running pipeline to stop.";
  $("#pipeline-reset").hidden = !job;
  $("#pipeline-reset").disabled = stoppingPipeline;
  $("#pipeline-clear").disabled = scraping || stoppingPipeline;
  $("#pipeline-clear").title = scraping ? "Stop the active pipeline before clearing." : "Permanently clear pipeline data and history.";
  $("#pipeline-continue").hidden = job?.status !== "failed" || job?.stagingBackend !== "supabase-storage" || job?.purpose === "clear";
  $("#pipeline-continue").disabled = scraping || stoppingPipeline;
  $("#pipeline-progress").hidden = !job;
  $("#scraper-result").classList.toggle("error", job?.status === "failed");
  if (!job) {
    $("#scraper-result").textContent = cleared ? "Pipeline data, run history and operation records cleared. Automatic runs are disabled." : "";
    for (const stage of ["reset", "scraper", "etl", "total"]) $(`#pipeline-time-${stage}`).textContent = "00:00";
    return;
  }
  const waiting = job.status === "queued" || job.executionState === "waiting";
  for (const stage of ["reset", "scraper", "etl"]) {
    const rawStatus = job.steps?.[stage]?.status || "waiting";
    const status = scraping && waiting && rawStatus === "running" ? "waiting" : rawStatus;
    $(`#pipeline-step-${stage}`).dataset.status = status;
    $(`#pipeline-step-${stage} .pipeline-marker`).textContent = status === "completed" ? "OK"
      : status === "failed" ? "!" : stage === "reset" ? "1" : stage === "scraper" ? "2" : "3";
    $(`#pipeline-status-${stage}`).textContent = {
      running: "Running", completed: "Completed", failed: "Failed", skipped: "Skipped", waiting: "Waiting", cancelled: "Stopped",
    }[status] || "Waiting";
  }
  updatePipelineClock();
  if (scraping) pipelineClock = setInterval(updatePipelineClock, 1000);
  const scrape = job.scraper
    ? `Scraper: ${job.scraper.pagesPersisted} pages, ${job.scraper.uniqueHackathonsPersisted} unique records. ` : "";
  const etl = job.etl
    ? `ETL: ${job.etl.processed} processed, ${job.etl.inserted} inserted, ${job.etl.failed} failed. ` : "";
  const reset = Object.entries(job.reset || {})
    .map(([database, count]) => `${database}: ${count} deleted`).join(", ");
  const resetSummary = reset ? `Reset ${reset}. ` : "";
  if (scraping && waiting) {
    $("#scraper-result").textContent = `${job.purpose === "clear" ? "Clear all: " : ""}${resetSummary}${scrape}${job.status === "queued" ? "Queued" : `Waiting to advance ${job.cursor?.phase || job.stage}`}. No worker is executing this step. Check that the Supabase cron tick is active.`;
    return;
  }
  if (job.cancelled) {
    $("#scraper-result").textContent = `${resetSummary}${scrape}${etl}${job.error} Automatic runs are disabled.`;
    return;
  }
  $("#scraper-result").textContent = scraping
    ? `${resetSummary}${scrape}${job.purpose === "clear" ? "Clear all is deleting data and will remove history after confirmed cleanup; no scraping or ETL will start." : `Running ${job.stage}.`} You can leave this page; the server continues the run.`
    : `${resetSummary}${scrape}${etl}${job.status === "completed" ? "Pipeline completed." : `Pipeline failed at ${job.stage}: ${job.error}`}`;
}

async function loadPipeline() {
  clearTimeout(pipelineTimer);
  try {
    const result = await api("pipeline");
    if (!authenticated) return;
    showPipeline(result.job);
    await loadPipelineSchedule(false);
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, scraping ? 3000 : 10000);
  } catch (error) {
    console.error("Could not load pipeline status:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not check pipeline status: ${error.message}`;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 5000);
  }
}

function showPipelineSchedule(schedule, updateSelection = true) {
  if (updateSelection) $("#pipeline-frequency").value = schedule.frequency;
  if (schedule.workerConfigured === false) {
    const needsWorker = scraping || schedule.frequency !== "off";
    $("#pipeline-schedule-status").classList.toggle("error", needsWorker || !!schedule.lastError);
    $("#pipeline-schedule-status").textContent = schedule.lastError || (needsWorker
      ? "Pipeline worker is not scheduled. Configure the active hackscout-edge-tick cron job in Supabase; queued runs cannot advance."
      : "Pipeline worker is stopped. Automatic runs are disabled.");
    return;
  }
  const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString(undefined, {
    timeZone: schedule.timeZone, dateStyle: "medium", timeStyle: "short",
  }) : null;
  $("#pipeline-schedule-status").classList.toggle("error", !!schedule.lastError);
  $("#pipeline-schedule-status").textContent = schedule.lastError ||
    (next ? `Next run: ${next} (${schedule.timeZone}).` : "Automatic runs are disabled.") +
    (schedule.keyConfigured ? "" : " Configure AI_API_KEY on the pipeline host (the workflow worker on Vercel) to enable a schedule.");
}

async function loadPipelineSchedule(updateSelection = true) {
  try {
    const result = await api("pipeline/schedule");
    if (authenticated) showPipelineSchedule(result.schedule, updateSelection);
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
    if (authenticated) showPipelineSchedule(result.schedule);
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
  if (scraping || stoppingPipeline) return;
  scraping = true;
  $("#scraper-run").disabled = true;
  $("#pipeline-reset").disabled = true;
  $("#pipeline-continue").disabled = true;
  $("#pipeline-clear").disabled = true;
  $("#scraper-result").classList.remove("error");
  $("#scraper-result").textContent = "Starting the scraper and ETL pipeline...";
  clearTimeout(pipelineTimer);
  clearInterval(pipelineClock);
  try {
    const request = api("pipeline/run", {
      method: "POST",
      body: { apiKey: $("#scraper-api-key").value.trim() },
    });
    $("#scraper-api-key").value = "";
    const result = await request;
    if (!authenticated) return;
    showPipeline(result.job);
  } catch (error) {
    console.error("Could not start pipeline:", error);
    scraping = false;
    if (authenticated) showPipeline(pipelineJob);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = error.message;
  } finally {
    $("#scraper-api-key").value = "";
    $("#pipeline-reset").disabled = stoppingPipeline;
    $("#pipeline-continue").disabled = scraping || stoppingPipeline;
    $("#pipeline-clear").disabled = scraping || stoppingPipeline;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 3000);
  }
});
