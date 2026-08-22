// Thin wrapper around Bright Data's Scraper Studio Collection API (/dca/*).
//
// Verified against this project's own arXiv collector dashboard ("Initiate by API" tab):
//   POST https://api.brightdata.com/dca/trigger?collector=<id>&queue_next=1
//   Body: [{ "url": "<fully resolved URL, no {topic} placeholder>" }]
//   Header: Authorization: Bearer <token>
//   GET  /dca/dataset?id=<id>    — fetch the snapshot once ready
//   POST /dca/collectors/{id}/refactor_template — triggers AI self-healing

const BASE_URL = "https://api.brightdata.com";
const TRIGGER_PARAM = "collector"; // confirmed correct against the dashboard

function authHeaders() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) {
    throw new Error(
      "BRIGHTDATA_API_TOKEN is not set. Copy backend/.env.example to backend/.env and fill it in."
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Trigger a collection run for a given collector.
 * @param {string} collectorId - c_xxxx
 * @param {object[]} inputs - array of { url } objects, e.g. [{ url: "https://arxiv.org/search/?query=OTFS" }]
 *   Build these with resolveSourceInput() from sources.config.js — don't hand-build URLs elsewhere.
 * @returns {Promise<string>} snapshotId
 */
async function triggerCollection(collectorId, inputs) {
  const url = `${BASE_URL}/dca/trigger?${TRIGGER_PARAM}=${encodeURIComponent(collectorId)}&queue_next=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(inputs),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trigger failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  // Field name varies by Bright Data product version — check both common shapes.
  const snapshotId = data.snapshot_id || data.collection_id || data.id;
  if (!snapshotId) {
    throw new Error(`Trigger succeeded but no snapshot/collection ID in response: ${JSON.stringify(data)}`);
  }
  return snapshotId;
}

/**
 * Poll a snapshot until it's ready, or give up after maxAttempts.
 * @param {string} snapshotId
 * @param {object} opts
 * @returns {Promise<object[]>} the collected records
 */
async function pollSnapshot(snapshotId, opts = {}) {
  const intervalMs = opts.intervalMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 60; // ~5 minutes at default interval

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${BASE_URL}/dca/dataset?id=${encodeURIComponent(snapshotId)}`, {
      headers: authHeaders(),
    });

    if (res.status === 202) {
      // still running
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Poll failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  throw new Error(`Snapshot ${snapshotId} did not complete after ${maxAttempts} attempts.`);
}

/**
 * Run a collector end-to-end: trigger + poll + return records.
 * @param {string} collectorId
 * @param {object[]} inputs
 */
async function runCollector(collectorId, inputs) {
  const snapshotId = await triggerCollection(collectorId, inputs);
  const records = await pollSnapshot(snapshotId);
  return { snapshotId, records };
}

/**
 * Trigger Bright Data's AI self-healing flow for a collector.
 * For the actual demo, prefer the CLI (`bdata scraper heal <collector_id> "<what broke>"`)
 * since it handles the human-approval gate for you. This function exists so the
 * backend can also show/react to heal status programmatically if needed.
 */
async function healCollector(collectorId, prompt) {
  const res = await fetch(`${BASE_URL}/dca/collectors/${collectorId}/refactor_template`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Heal trigger failed (${res.status}): ${body}`);
  }

  return res.json();
}

module.exports = { triggerCollection, pollSnapshot, runCollector, healCollector };