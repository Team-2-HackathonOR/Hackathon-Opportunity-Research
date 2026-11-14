function canAdvancePipeline(job) {
  return job?.status === "failed" && job.cancelled === true && job.stagingBackend === "supabase-storage" &&
    job.purpose !== "clear" && job.cursor?.phase === "scraper" && job.steps?.reset?.status === "completed";
}

$("#pipeline-next-step").addEventListener("click", async () => {
  if (!authenticated || !canAdvancePipeline(pipelineJob) || scraping || stoppingPipeline) return;
  const apiKey = $("#scraper-api-key").value.trim();
  if (!apiKey) {
    notify("Enter a new AI API key above before advancing to ETL.", true);
    $("#scraper-api-key").focus();
    return;
  }
  if (!confirm("End scraping now and go to ETL? Only records already staged will be imported; remaining Devpost pages will not be scraped. Existing data and operation history are retained. Unconfirmed operations or unfinished cleanup will block advancement.")) return;
  stoppingPipeline = true;
  for (const id of ["pipeline-next-step", "pipeline-clear", "pipeline-continue", "pipeline-reset", "pipeline-stop", "scraper-run"]) $(`#${id}`).disabled = true;
  clearTimeout(pipelineTimer);
  $("#scraper-result").classList.remove("error");
  $("#scraper-result").textContent = "Verifying staged records before advancing to ETL...";
  try {
    const request = api("pipeline/next-step", {
      method: "POST", body: { jobId: pipelineJob.id, apiKey, confirmation: "ADVANCE TO ETL" },
    });
    $("#scraper-api-key").value = "";
    const result = await request;
    if (!authenticated) return;
    showPipeline(result.job);
  } catch (error) {
    console.error("Could not advance pipeline:", error);
    $("#scraper-result").classList.add("error");
    $("#scraper-result").textContent = `Could not advance pipeline: ${error.message}`;
  } finally {
    $("#scraper-api-key").value = "";
    stoppingPipeline = false;
    for (const id of ["pipeline-next-step", "pipeline-clear", "pipeline-continue", "pipeline-reset", "scraper-run"]) $(`#${id}`).disabled = scraping;
    $("#pipeline-stop").disabled = !scraping;
    if (authenticated) pipelineTimer = setTimeout(loadPipeline, 3000);
  }
});
