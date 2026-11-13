$("#pipeline-stop").addEventListener("click", async () => {
  if (!pipelineJob || !scraping || stoppingPipeline) return;
  if (!confirm("Stop this pipeline and disable automatic runs? Completed deletions cannot be undone, and an operation already executing may finish.")) return;
  stoppingPipeline = true;
  $("#pipeline-clear").disabled = true;
  $("#pipeline-continue").disabled = true;
  $("#pipeline-stop").disabled = true;
  $("#pipeline-reset").disabled = true;
  clearTimeout(pipelineTimer);
  try {
    const result = await api("pipeline/cancel", {
      method: "POST", body: { jobId: pipelineJob.id },
    });

    if (!authenticated) return;
    showPipeline(result.job);
    await loadPipelineSchedule();
  } catch (error) {
    console.error("Could not stop pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not stop pipeline: ${error.message}`;
  } finally {
    stoppingPipeline = false;
    $("#pipeline-clear").disabled = scraping;
    $("#pipeline-continue").disabled = scraping;
    $("#pipeline-stop").disabled = !scraping;
    $("#pipeline-reset").disabled = false;
    $("#scraper-run").disabled = scraping;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 5000);
  }
});

$("#pipeline-reset").addEventListener("click", async () => {
  if (!pipelineJob || stoppingPipeline) return;
  const apiKey = $("#scraper-api-key").value.trim();
  if (!apiKey) {
    notify("Enter a new AI API key above before resetting the pipeline.", true);
    $("#scraper-api-key").focus();
    return;
  }
  if (!confirm("Reset and restart the full pipeline? This permanently deletes scraper records and event listings, disables automatic runs, and starts scraping and ETL again. An uncertain operation will block the restart.")) return;
  stoppingPipeline = true;
  $("#pipeline-clear").disabled = true;
  $("#pipeline-continue").disabled = true;
  $("#pipeline-reset").disabled = true;
  $("#pipeline-stop").disabled = true;
  $("#scraper-run").disabled = true;
  clearTimeout(pipelineTimer);
  try {
    const request = api("pipeline/restart", {
      method: "POST", body: { jobId: pipelineJob.id, apiKey },
    });
    $("#scraper-api-key").value = "";
    const result = await request;
    if (!authenticated) return;
    showPipeline(result.job);
    await loadPipelineSchedule();
  } catch (error) {
    console.error("Could not reset pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not reset pipeline: ${error.message}`;
  } finally {
    $("#scraper-api-key").value = "";
    stoppingPipeline = false;
    $("#pipeline-clear").disabled = scraping;
    $("#pipeline-continue").disabled = scraping;
    $("#pipeline-reset").disabled = false;
    $("#pipeline-stop").disabled = !scraping;
    $("#scraper-run").disabled = scraping;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 5000);
  }
});
