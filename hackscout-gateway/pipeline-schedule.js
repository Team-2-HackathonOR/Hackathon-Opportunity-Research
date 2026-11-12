const { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } = require("node:fs");
const { dirname, join } = require("node:path");

const frequencies = ["off", "weekly", "biweekly", "monthly"];
const zone = "Europe/Rome";
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localParts(date) {
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => ["year", "month", "day", "hour", "minute"].includes(part.type))
    .map((part) => [part.type, Number(part.value)]));
}

function nextOccurrence(after, frequency, recurring = false) {
  const parts = localParts(after);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const firstOffset = recurring ? frequency === "biweekly" ? 14 : 1 : 0;
  for (let offset = firstOffset; offset <= 62; offset += 1) {
    const candidate = new Date(day.getTime() + offset * 86400000);
    if (frequency === "monthly" ? candidate.getUTCDate() !== 1 : candidate.getUTCDay() !== 0) continue;
    // On the spring DST transition, 02:00 does not exist; use the first later local minute.
    for (let minute = -180; minute <= 240; minute += 1) {
      const instant = new Date(candidate.getTime() + minute * 60000);
      const local = localParts(instant);
      if (local.year === candidate.getUTCFullYear() && local.month === candidate.getUTCMonth() + 1 &&
          local.day === candidate.getUTCDate() && local.hour >= 2) {
        if (instant > after) return instant.toISOString();
        break;
      }
    }
  }
  throw new Error("Could not determine the next pipeline schedule time.");
}

function createPipelineSchedule(pipeline, {
  storePath = process.env.PIPELINE_SCHEDULE_PATH || join(__dirname, ".data", "pipeline-schedule.json"),
  now = () => new Date(),
  getApiKey = () => process.env.AI_API_KEY?.trim(),
  startTimer = true,
} = {}) {
  let schedule = { frequency: "off", nextRunAt: null };
  let lastError = null;
  if (existsSync(storePath)) {
    schedule = JSON.parse(readFileSync(storePath, "utf8"));
    if (!schedule || !frequencies.includes(schedule.frequency) ||
        (schedule.frequency !== "off" && (typeof schedule.nextRunAt !== "string" ||
          !Number.isFinite(Date.parse(schedule.nextRunAt))))) {
      throw new Error("The persisted pipeline schedule is invalid.");
    }
  }

  function persist(value) {
    mkdirSync(dirname(storePath), { recursive: true });
    const temporary = `${storePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporary, storePath);
  }

  function reportError(message) {
    if (lastError !== message) console.error("Automatic pipeline run:", message);
    lastError = message;
  }

  function tick() {
    if (schedule.frequency === "off" || Date.parse(schedule.nextRunAt) > now().getTime()) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      reportError("AI_API_KEY is not configured on the HackScout backend.");
      return;
    }
    if (pipeline.get()?.status === "running") {
      reportError("Waiting for the current pipeline run to finish.");
      return;
    }
    try {
      let nextRunAt = schedule.nextRunAt;
      do {
        nextRunAt = nextOccurrence(new Date(nextRunAt), schedule.frequency, true);
      } while (Date.parse(nextRunAt) <= now().getTime());
      const updated = { ...schedule, nextRunAt, lastTriggeredAt: now().toISOString() };
      persist(updated);
      schedule = updated;
      if (!pipeline.start(apiKey)) throw new Error("A pipeline run is already in progress.");
      lastError = null;
    } catch (error) {
      reportError(error.message);
    }
  }

  const timer = startTimer ? setInterval(tick, 30000) : null;
  timer?.unref();
  return {
    get() {
      return { ...schedule, timeZone: zone, time: "02:00", keyConfigured: !!getApiKey(), lastError };
    },
    update(frequency) {
      if (!frequencies.includes(frequency)) throw new Error("Choose a valid pipeline frequency.");
      if (frequency !== "off" && !getApiKey()) {
        throw new Error("Configure AI_API_KEY on the HackScout backend before enabling automatic runs.");
      }
      const updated = {
        frequency,
        nextRunAt: frequency === "off" ? null : nextOccurrence(now(), frequency),
      };
      persist(updated);
      schedule = updated;
      lastError = null;
      return this.get();
    },
    tick,
    close() { if (timer) clearInterval(timer); },
  };
}

module.exports = { createPipelineSchedule, nextOccurrence };
