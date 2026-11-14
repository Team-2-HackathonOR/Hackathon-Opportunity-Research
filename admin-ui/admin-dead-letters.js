let deadLetterBefore = null;
let deadLetterNext = null;
let deadLetterRequest = 0;

function resetDeadLetters() {
  deadLetterRequest++;
  deadLetterBefore = deadLetterNext = null;
  for (const id of ["dead-letter-count", "dead-letter-list", "dead-letter-detail"]) $(`#${id}`).textContent = "";
  $("#dead-letter-id").value = "";
  $("#dead-letter-older").disabled = true;
}

async function loadDeadLetters(before = deadLetterBefore) {
  if (!authenticated) return;
  const sequence = ++deadLetterRequest;
  deadLetterBefore = before;
  deadLetterNext = null;
  $("#dead-letter-refresh").disabled = $("#dead-letter-older").disabled = true;
  try {
    const result = await api(`pipeline/dead-letters${before ? `?beforeId=${encodeURIComponent(before)}` : ""}`);
    if (!authenticated || sequence !== deadLetterRequest) return;
    if (!Array.isArray(result.items) || result.items.length > 20 ||
        !Number.isSafeInteger(result.total) || result.total < 0 ||
        result.nextBeforeId !== null && (typeof result.nextBeforeId !== "string" || !/^[1-9][0-9]*$/.test(result.nextBeforeId))) {
      throw new Error("The dead-letter queue response is invalid.");
    }
    $("#dead-letter-count").textContent = `${result.total} pending dead-letter record${result.total === 1 ? "" : "s"}.`;
    $("#dead-letter-list").classList.remove("error");
    $("#dead-letter-list").textContent = result.items.length ? result.items.map((item) =>
      `Dead letter ${item.id} | source ${item.source_record_id} | ${item.created_at}\nRun ${item.job_id} | ${item.operation_name}\n${item.reason}` +
      (item.validation_errors ? `\nValidation: ${JSON.stringify(item.validation_errors)}` : "")
    ).join("\n\n") : before ? "No older pending records." : "No records awaiting instructions.";
    deadLetterNext = result.nextBeforeId;
  } catch (error) {
    console.error("Could not load dead letters:", error);
    if (authenticated && sequence === deadLetterRequest) {
      $("#dead-letter-list").classList.add("error");
      $("#dead-letter-list").textContent = `Could not load dead-letter queue: ${error.message}`;
    }
  } finally {
    if (sequence === deadLetterRequest) {
      $("#dead-letter-refresh").disabled = !authenticated;
      $("#dead-letter-older").disabled = !authenticated || !deadLetterNext;
    }
  }
}

$("#dead-letter-refresh").addEventListener("click", () => loadDeadLetters(null));
$("#dead-letter-older").addEventListener("click", () => {
  if (deadLetterNext) return loadDeadLetters(deadLetterNext);
});
$("#dead-letter-view").addEventListener("click", async () => {
  if (!authenticated) return;
  const id = $("#dead-letter-id").value.trim();
  $("#dead-letter-view").disabled = true;
  $("#dead-letter-detail").textContent = "";
  try {
    if (!/^[1-9][0-9]{0,18}$/.test(id)) throw new Error("Enter a dead-letter ID from the list.");
    const result = await api(`pipeline/dead-letters/${encodeURIComponent(id)}`);
    if (!authenticated) return;
    if (!result.item || result.item.id !== id || typeof result.item.raw_record !== "object" || !result.item.raw_record) {
      throw new Error("The dead-letter detail response is invalid.");
    }
    $("#dead-letter-detail").classList.remove("error");
    $("#dead-letter-detail").textContent = JSON.stringify(result.item, null, 2);
  } catch (error) {
    console.error("Could not view dead letter:", error);
    if (authenticated) {
      $("#dead-letter-detail").classList.add("error");
      $("#dead-letter-detail").textContent = `Could not view dead-letter record: ${error.message}`;
    }
  } finally { $("#dead-letter-view").disabled = !authenticated; }
});
