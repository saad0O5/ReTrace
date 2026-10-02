const assert = require("assert");
const { getScheduleConfig, parseScheduleSources } = require("../src/scheduler");

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

try {
  resetEnv();
  process.env.RETRACE_SCHEDULE_ENABLED = "true";
  process.env.RETRACE_SCHEDULE_INTERVAL_MS = "90000";
  process.env.RETRACE_SCHEDULE_SOURCES = "arxiv,github";
  process.env.RETRACE_TOPIC = "custom topic";

  const cfg = getScheduleConfig();
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.intervalMs, 90000);
  assert.deepStrictEqual(cfg.sources, ["arxiv", "github"]);
  assert.strictEqual(cfg.topic, "custom topic");

  resetEnv();
  process.env.RETRACE_SCHEDULE_SOURCES = " arxiv , github ,  ";
  assert.deepStrictEqual(parseScheduleSources(process.env.RETRACE_SCHEDULE_SOURCES), ["arxiv", "github"]);

  resetEnv();
  process.env.RETRACE_SCHEDULE_ENABLED = "false";
  const disabled = getScheduleConfig();
  assert.strictEqual(disabled.enabled, false);

  console.log("Scheduler config tests passed.");
} catch (err) {
  console.error("Scheduler config tests failed:", err.message);
  process.exit(1);
} finally {
  process.env = { ...originalEnv };
}
