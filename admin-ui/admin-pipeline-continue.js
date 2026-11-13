$("#pipeline-continue").addEventListener("click", async () => {
  if (!pipelineJob || pipelineJob.status !== "failed" || scraping || stoppingPipeline) return;
  const apiKey = $("#scraper-api-key").value.trim();
  if (!apiKey) {
    notify("Enter a new AI API key above before continuing the pipeline.", true);
    $("#scraper-api-key").focus();
    return;
  }
  const phase = pipelineJob.cursor?.phase || pipelineJob.stage;
  const cleanup = phase.startsWith("reset-") ? " The cleanup already underway will finish deleting its remaining records." : "";
  if (!confirm(`Continue from the saved ${phase} checkpoint without starting over?${cleanup} An uncertain operation will block continuation.`)) return;
  stoppingPipeline = true;
  $("#pipeline-clear").disabled = true;
  for (const selector of ["#pipeline-continue", "#pipeline-reset", "#pipeline-stop", "#scraper-run"]) $(selector).disabled = true;
  clearTimeout(pipelineTimer);
  $("#scraper-result").classList.remove("error");
  $("#scraper-result").textContent = `Continuing from ${phase}...`;
  try {
    const request = api("pipeline/continue", {
      method: "POST", body: { jobId: pipelineJob.id, apiKey },
    });
    $("#scraper-api-key").value = "";
    const result = await request;
    if (!authenticated) return;
    showPipeline(result.job);
  } catch (error) {
    console.error("Could not continue pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not continue pipeline: ${error.message}`;
  } finally {
    $("#scraper-api-key").value = "";
    stoppingPipeline = false;
    $("#pipeline-clear").disabled = scraping;
    $("#pipeline-continue").disabled = scraping;
    $("#pipeline-reset").disabled = false;
    $("#pipeline-stop").disabled = !scraping;
    $("#scraper-run").disabled = scraping;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 3000);
  }
});
