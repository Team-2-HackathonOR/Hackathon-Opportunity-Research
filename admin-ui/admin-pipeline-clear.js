$("#pipeline-clear").addEventListener("click", async () => {
  if (!authenticated || scraping || stoppingPipeline) return;
  if (!confirm("Clear ALL pipeline data and history? This permanently deletes staged scraper records, event listings, all pipeline runs and operation records. Automatic runs will be disabled. Accounts, submissions and reviews are preserved. No new scraping or ETL will start. This cannot be undone.")) return;
  stoppingPipeline = true;
  for (const id of ["pipeline-clear", "pipeline-stop", "pipeline-reset", "pipeline-continue", "scraper-run"]) $(`#${id}`).disabled = true;
  clearTimeout(pipelineTimer);
  $("#scraper-api-key").value = "";
  try {
    const result = await api("pipeline/clear", {
      method: "POST", body: { jobId: pipelineJob?.id ?? null, confirmation: "CLEAR ALL" },
    });
    if (!authenticated) return;
    showPipeline(result.job);
    await loadPipelineSchedule();
  } catch (error) {
    console.error("Could not clear pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not clear pipeline: ${error.message}`;
  } finally {
    stoppingPipeline = false;
    $("#pipeline-clear").disabled = !authenticated || scraping;
    $("#pipeline-stop").disabled = !scraping;
    $("#pipeline-reset").disabled = scraping;
    $("#pipeline-continue").disabled = scraping;
    $("#scraper-run").disabled = scraping;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 3000);
  }
});
