// One-off script to create and test the Duke Calderbank publications collector
// via the Bright Data REST API, then save raw output to backend/raw/
require(require("path").join(__dirname, "..", "backend", "node_modules", "dotenv")).config({ path: require("path").join(__dirname, "..", "backend", ".env") });
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://api.brightdata.com";
const token = process.env.BRIGHTDATA_API_TOKEN;
const DUKE_URL = "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications";

async function createCollector() {
  const res = await fetch(`${BASE_URL}/dca/scraper`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: DUKE_URL,
      extraction_prompt:
        "Extract all publications listed on this academic faculty page. For each publication extract: title, authors (as a list), year or date, journal or conference name, DOI if present, and any URL or link to the publication.",
    }),
  });

  const body = await res.text();
  console.log("Create collector status:", res.status);
  console.log("Create collector response:", body);

  if (!res.ok) {
    throw new Error(`Create failed: ${body}`);
  }

  return JSON.parse(body);
}

async function listCollectors() {
  const res = await fetch(`${BASE_URL}/dca/scrapers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  console.log("Collectors:", JSON.stringify(body, null, 2).slice(0, 2000));
  return body;
}

async function triggerAndWait(collectorId) {
  console.log(`\nTriggering collector ${collectorId} on ${DUKE_URL}...`);
  const triggerRes = await fetch(
    `${BASE_URL}/dca/trigger?collector=${encodeURIComponent(collectorId)}&queue_next=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ url: DUKE_URL }]),
    }
  );

  const triggerBody = await triggerRes.text();
  console.log("Trigger status:", triggerRes.status);
  console.log("Trigger response:", triggerBody);

  if (!triggerRes.ok) {
    throw new Error(`Trigger failed (${triggerRes.status}): ${triggerBody}`);
  }

  const triggerData = JSON.parse(triggerBody);
  const snapshotId = triggerData.snapshot_id || triggerData.collection_id || triggerData.id;
  console.log("Snapshot ID:", snapshotId);

  // Poll
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(
      `${BASE_URL}/dca/dataset?id=${encodeURIComponent(snapshotId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (pollRes.status === 202) {
      console.log(`Attempt ${i + 1}: still running...`);
      continue;
    }
    if (!pollRes.ok) {
      const pb = await pollRes.text();
      throw new Error(`Poll failed (${pollRes.status}): ${pb}`);
    }

    const records = await pollRes.json();
    console.log(`\nGot ${records.length} records!`);

    const outDir = path.join(__dirname, "backend", "raw");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `manual-duke-calderbank-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
    console.log(`Raw output saved to ${outPath}`);
    console.log("First record:", JSON.stringify(records[0], null, 2));
    return records;
  }

  throw new Error("Timed out waiting for snapshot");
}

async function main() {
  const action = process.argv[2];

  if (action === "list") {
    await listCollectors();
    return;
  }

  if (action === "trigger") {
    const collectorId = process.argv[3];
    if (!collectorId) {
      console.error("Usage: node scratch/createDukeCollector.js trigger <collector_id>");
      process.exit(1);
    }
    await triggerAndWait(collectorId);
    return;
  }

  // Default: create
  console.log("Creating Duke Calderbank collector...");
  const result = await createCollector();
  console.log("\nCollector created:", JSON.stringify(result, null, 2));
  console.log("\nCollector ID to save:", result.id || result.collector_id);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
