// CLI entry point for ReTrace Research Change Detection (Phase 1).
// Compares consecutive successful collection runs per source,
// detects NEW / UPDATED / REMOVED artifacts, and persists ResearchSignals.
//
// Usage:
//   node scripts/detectChanges.js
//   node scripts/detectChanges.js [sourceName]

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));
const { compareCollections } = require("../backend/src/analysis/changeDetector");
const { generateSignalsFromComparison } = require("../backend/src/analysis/signalService");

const prisma = new PrismaClient();

async function run() {
  const targetSource = process.argv[2];

  console.log("\n============================================================");
  console.log("RETRACE RESEARCH CHANGE DETECTION");
  console.log("============================================================\n");

  const space = await prisma.researchSpace.findFirst();
  if (!space) {
    console.error("No ResearchSpace found. Run the backend once to seed the research space.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const sourceWhere = { researchSpaceId: space.id };
  if (targetSource) {
    sourceWhere.name = targetSource;
  }

  const sources = await prisma.source.findMany({ where: sourceWhere });
  if (sources.length === 0) {
    console.log(`No sources found${targetSource ? ` matching "${targetSource}"` : ""}.`);
    await prisma.$disconnect();
    return;
  }

  let totalNew = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalUnchanged = 0;
  let totalSignalsCreated = 0;

  for (const source of sources) {
    console.log(`Source: ${source.name.toUpperCase()} (Collector: ${source.collectorId || "UNSET"})`);

    // Fetch successful collections ordered newest first
    const successfulCollections = await prisma.collection.findMany({
      where: {
        sourceId: source.id,
        status: "SUCCESS",
      },
      orderBy: { startedAt: "desc" },
    });

    if (successfulCollections.length < 2) {
      const recs = successfulCollections[0]?.recordCount || 0;
      console.log(`  Status: Baseline established (${recs} records) — no previous successful scan available.`);
      console.log(`  Need at least 2 successful collections to perform delta analysis.\n`);
      continue;
    }

    const currentCollection = successfulCollections[0];
    const previousCollection = successfulCollections[1];

    console.log(`  Comparing:`);
    console.log(`    - Previous: ${previousCollection.id.slice(0, 10)}... (${previousCollection.recordCount} records, ${new Date(previousCollection.startedAt).toLocaleString()})`);
    console.log(`    - Current:  ${currentCollection.id.slice(0, 10)}... (${currentCollection.recordCount} records, ${new Date(currentCollection.startedAt).toLocaleString()})`);

    const comparison = await compareCollections(previousCollection, currentCollection, prisma);

    if (!comparison.eligible) {
      console.log(`  Skipped: ${comparison.error}\n`);
      continue;
    }

    const { summary } = comparison;
    console.log(`\n  DELTA SUMMARY:`);
    console.log(`    + NEW:       ${summary.new}`);
    console.log(`    ~ UPDATED:   ${summary.updated}`);
    console.log(`    - ABSENT:    ${summary.removed}`);
    console.log(`    = UNCHANGED: ${summary.unchanged}`);

    if (comparison.newArtifacts.length > 0) {
      console.log(`\n  New Artifacts:`);
      comparison.newArtifacts.slice(0, 5).forEach((a) => {
        console.log(`    + [${a.type}] "${a.title}"`);
      });
      if (comparison.newArtifacts.length > 5) {
        console.log(`    ... and ${comparison.newArtifacts.length - 5} more`);
      }
    }

    if (comparison.updatedArtifacts.length > 0) {
      console.log(`\n  Updated Artifacts:`);
      comparison.updatedArtifacts.slice(0, 5).forEach((a) => {
        console.log(`    ~ [${a.type}] "${a.title}" (${a.changes.join("; ")})`);
      });
      if (comparison.updatedArtifacts.length > 5) {
        console.log(`    ... and ${comparison.updatedArtifacts.length - 5} more`);
      }
    }

    if (comparison.removedArtifacts.length > 0) {
      console.log(`\n  Absent/Not Observed:`);
      comparison.removedArtifacts.slice(0, 5).forEach((a) => {
        console.log(`    - [${a.type}] "${a.title}"`);
      });
    }

    // Persist signals
    const signalResult = await generateSignalsFromComparison(comparison, prisma);
    console.log(`\n  Signals: ${signalResult.created} created, ${signalResult.existing} already existed.`);
    console.log("------------------------------------------------------------\n");

    totalNew += summary.new;
    totalUpdated += summary.updated;
    totalRemoved += summary.removed;
    totalUnchanged += summary.unchanged;
    totalSignalsCreated += signalResult.created;
  }

  console.log("============================================================");
  console.log(`TOTAL CHANGES: +${totalNew} NEW, ~${totalUpdated} UPDATED, -${totalRemoved} ABSENT, =${totalUnchanged} UNCHANGED`);
  console.log(`RESEARCH SIGNALS CREATED: ${totalSignalsCreated}`);
  console.log("============================================================\n");

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Change detection failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
