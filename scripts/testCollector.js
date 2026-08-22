// Standalone sanity check — no database, no Express. Run this FIRST, before
// touching the server, to confirm the Bright Data connection itself works.
//
// Usage:
//   node scripts/testCollector.js arxiv "OTFS channel estimation"
//   node scripts/testCollector.js github "OTFS channel estimation"

// dotenv lives in backend/node_modules (that's the only place `npm install` ran) —
// resolve it explicitly rather than requiring a second root-level `npm install`.
require(require("path").join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: require("path").join(__dirname, "..", "backend", ".env"),
});
const fs = require("fs");
const path = require("path");
const { runCollector } = require("../backend/src/collectors/brightdata");
const { sources, resolveSourceInput } = require("../backend/src/collectors/sources.config");

async function main() {
  const [, , sourceName, topic] = process.argv;

  if (!sourceName || !sources[sourceName]) {
    console.error(`Usage: node scripts/testCollector.js <${Object.keys(sources).join("|")}> "<topic>"`);
    process.exit(1);
  }

  const cfg = sources[sourceName];
  if (!cfg.collectorId) {
    console.error(
      `No collector ID set for "${sourceName}". Run bdata scraper create for it, ` +
      `then set BRIGHTDATA_${sourceName.toUpperCase()}_COLLECTOR_ID in backend/.env.`
    );
    process.exit(1);
  }

  const finalTopic = topic || "OTFS channel estimation";
  const input = resolveSourceInput(cfg, finalTopic);
  console.log(`Triggering ${sourceName} collector (${cfg.collectorId})`);
  console.log(`Resolved URL: ${input.url}`);

  const { snapshotId, records } = await runCollector(cfg.collectorId, [input]);

  console.log(`Snapshot ${snapshotId} complete. ${records.length} record(s) received.`);

  const outDir = path.join(__dirname, "..", "backend", "raw");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `manual-${sourceName}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));

  console.log(`Raw output saved to ${outPath}`);
  console.log("Inspect this file before writing the normalizer — confirm the actual field names Bright Data returned.");
}

main().catch((err) => {
  console.error("Failed:", err.message || err);
  process.exit(1);
});