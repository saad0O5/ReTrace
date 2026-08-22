// Reads a raw arXiv collection JSON file (an array of records, exactly what
// scripts/testCollector.js saves under backend/raw/) and writes normalized,
// deduplicated Artifact rows into the database, with a Collection +
// ArtifactVersion trail so re-running this later against a fresh pull gives
// you real "since last scan" history (Phase 6).
//
// Usage:
//   node scripts/ingestRaw.js backend/raw/manual-arxiv-<timestamp>.json

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const fs = require("fs");
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));
const { normalizeArxivRecord } = require("../backend/src/ingestion/normalizer");

const prisma = new PrismaClient();

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/ingestRaw.js <path-to-raw-json>");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`Loaded ${raw.length} raw records from ${filePath}`);

  const space = await prisma.researchSpace.findFirst({ where: { name: "OTFS Channel Estimation" } });
  if (!space) {
    console.error("No ResearchSpace found. Run the backend once (npm run dev in backend/) so it seeds one, then retry.");
    process.exit(1);
  }

  const source = await prisma.source.findFirst({ where: { researchSpaceId: space.id, name: "arxiv" } });
  if (!source) {
    console.error("No arxiv Source row found. Same fix as above.");
    process.exit(1);
  }

  const collection = await prisma.collection.create({
    data: { sourceId: source.id, status: "RUNNING", rawFilePath: filePath },
  });

  const normalized = raw.map(normalizeArxivRecord);
  let created = 0;
  let alreadySeen = 0;

  for (const artifact of normalized) {
    const existing = await prisma.artifact.findFirst({
      where: { researchSpaceId: space.id, url: artifact.url },
    });

    if (existing) {
      // Same paper seen before - update lastSeen, don't duplicate the artifact row.
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

  const missingDate = normalized.filter((a) => !a.publishedAt).length;

  console.log(`Ingested: ${created} new artifacts, ${alreadySeen} already existed (lastSeen updated).`);
  console.log(`Missing published_date: ${missingDate} of ${normalized.length} records.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});