// Reads a raw collection JSON file (an array of records, exactly what
// scripts/testCollector.js saves under backend/raw/) and writes normalized,
// deduplicated Artifact rows into the database, with a Collection +
// ArtifactVersion trail so re-running this later against a fresh pull gives
// you real "since last scan" history (Phase 6).
//
// Source-aware: detects arxiv vs github from the filename convention
// testCollector.js uses (manual-<source>-<timestamp>.json), or accepts an
// explicit override as a second argument.
//
// Usage:
//   node scripts/ingestRaw.js backend/raw/manual-arxiv-<timestamp>.json
//   node scripts/ingestRaw.js backend/raw/manual-github-<timestamp>.json
//   node scripts/ingestRaw.js <path> github   (explicit override)

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const fs = require("fs");
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));
const { normalizeArxivRecord, normalizeGithubRecord } = require("../backend/src/ingestion/normalizer");

const prisma = new PrismaClient();

const NORMALIZERS = {
  arxiv: normalizeArxivRecord,
  github: normalizeGithubRecord,
};

function detectSourceFromFilename(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/^manual-(arxiv|github)-/);
  return match ? match[1] : null;
}

async function main() {
  const filePath = process.argv[2];
  const sourceOverride = process.argv[3];

  if (!filePath) {
    console.error("Usage: node scripts/ingestRaw.js <path-to-raw-json> [source-override]");
    process.exit(1);
  }

  const sourceName = sourceOverride || detectSourceFromFilename(filePath);
  if (!sourceName || !NORMALIZERS[sourceName]) {
    console.error(
      `Could not determine source ("${sourceName}"). Expected filename like ` +
      `manual-arxiv-*.json or manual-github-*.json, or pass an explicit source ` +
      `as the second argument: node scripts/ingestRaw.js <path> <arxiv|github>`
    );
    process.exit(1);
  }
  const normalizeRecord = NORMALIZERS[sourceName];

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`Loaded ${raw.length} raw records from ${filePath} (source: ${sourceName})`);

  const space = await prisma.researchSpace.findFirst({ where: { name: "OTFS Channel Estimation" } });
  if (!space) {
    console.error("No ResearchSpace found. Run the backend once (npm run dev in backend/) so it seeds one, then retry.");
    process.exit(1);
  }

  const source = await prisma.source.findFirst({ where: { researchSpaceId: space.id, name: sourceName } });
  if (!source) {
    console.error(`No "${sourceName}" Source row found. Same fix as above.`);
    process.exit(1);
  }

  const collection = await prisma.collection.create({
    data: { sourceId: source.id, status: "RUNNING", rawFilePath: filePath },
  });

  let normalized;
  const failedRecords = [];
  normalized = raw
    .map((r) => {
      try {
        return normalizeRecord(r);
      } catch (err) {
        failedRecords.push({ error: err.message, raw: r });
        return null;
      }
    })
    .filter(Boolean);

  if (failedRecords.length > 0) {
    console.warn(`${failedRecords.length} record(s) failed normalization and were skipped:`);
    failedRecords.forEach((f) => console.warn(`  - ${f.error}`));
  }

  let created = 0;
  let alreadySeen = 0;

  for (const artifact of normalized) {
    const existing = await prisma.artifact.findFirst({
      where: { researchSpaceId: space.id, url: artifact.url },
    });

    if (existing) {
      // Same artifact seen before - update lastSeen, don't duplicate the row.
      await prisma.artifact.update({ where: { id: existing.id }, data: { lastSeen: new Date() } });
      alreadySeen++;
      continue;
    }

    const saved = await prisma.artifact.create({ data: { ...artifact, researchSpaceId: space.id } });

    await prisma.artifactVersion.create({
      data: {
        artifactId: saved.id,
        collectionId: collection.id,
        contentHash: Buffer.from(artifact.title + (artifact.description || "")).toString("base64").slice(0, 32),
        metadata: artifact.metadata,
      },
    });

    created++;
  }

  await prisma.collection.update({
    where: { id: collection.id },
    data: { status: "SUCCESS", completedAt: new Date(), recordCount: normalized.length },
  });

  await prisma.source.update({
    where: { id: source.id },
    data: { lastRun: new Date(), lastSuccessAt: new Date() },
  });

  console.log(`Ingested: ${created} new artifacts, ${alreadySeen} already existed (lastSeen updated).`);

  if (sourceName === "arxiv") {
    const missingDate = normalized.filter((a) => !a.publishedAt).length;
    console.log(`Missing published_date: ${missingDate} of ${normalized.length} records.`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});