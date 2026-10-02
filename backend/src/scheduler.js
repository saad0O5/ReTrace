const { sources } = require("./collectors/sources.config");

function parseScheduleSources(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((name) => !!sources[name]);
}

function getScheduleConfig() {
  const enabled = String(process.env.RETRACE_SCHEDULE_ENABLED || "false").toLowerCase() === "true";
  const intervalMs = Number(process.env.RETRACE_SCHEDULE_INTERVAL_MS || "60000");
  const configuredSources = parseScheduleSources(process.env.RETRACE_SCHEDULE_SOURCES || "");
  const topic = process.env.RETRACE_TOPIC || process.env.RETRACE_SPACE_TOPIC || "OTFS channel estimation";

  return {
    enabled,
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60000,
    sources: configuredSources.length > 0 ? configuredSources : Object.keys(sources),
    topic,
  };
}

function scheduleRecurringRuns({ onTick, intervalMs = 60000, enabled = false } = {}) {
  if (!enabled || typeof onTick !== "function") {
    return null;
  }

  return setInterval(() => {
    onTick();
  }, intervalMs);
}

module.exports = {
  parseScheduleSources,
  getScheduleConfig,
  scheduleRecurringRuns,
};
