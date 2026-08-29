require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { prisma } = require("./database/client");
const { getSourcesWithHealth } = require("./database/sourceHealth");
const { runCollector } = require("./collectors/brightdata");
const { sources, resolveSourceInput } = require("./collectors/sources.config");

const app = express();
app.use(cors());
app.use(express.json());

const RAW_DIR = path.join(__dirname, "..", "raw");
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

const DEFAULT_SPACE_NAME = "OTFS Channel Estimation";
const DEFAULT_TOPIC = "OTFS channel estimation";

/**
 * Make sure a ResearchSpace exists, and a Source row exists for every entry
 * in sources.config.js. Safe to call on every startup — upserts, no duplicates.
 */
async function ensureSeeded() {
  let space = await prisma.researchSpace.findFirst({ where: { name: DEFAULT_SPACE_NAME } });
  if (!space) {
    space = await prisma.researchSpace.create({
      data: { name: DEFAULT_SPACE_NAME, topic: DEFAULT_TOPIC },
    });
    console.log(`Created ResearchSpace: ${space.id} (${space.name})`);
  }

  for (const key of Object.keys(sources)) {
    const cfg = sources[key];
    const existing = await prisma.source.findFirst({
      where: { researchSpaceId: space.id, name: cfg.name },
    });
    if (!existing) {
      await prisma.source.create({
        data: {
          researchSpaceId: space.id,
          name: cfg.name,
          baseUrl: cfg.urlTemplate,
          collectorId: cfg.collectorId || "UNSET",
          artifactTypes: cfg.artifactTypes.join(","),
        },
      });
      console.log(`Created Source: ${cfg.name}`);
    } else if (cfg.collectorId && existing.collectorId !== cfg.collectorId) {
      // A collector ID can change (e.g. regenerated after a stale-selector break),
      // and .env is the source of truth — sync it rather than leaving a stale ID
      // sitting in the DB from whenever this Source row was first created.
      await prisma.source.update({
        where: { id: existing.id },
        data: { collectorId: cfg.collectorId, baseUrl: cfg.urlTemplate },
      });
      console.log(`Synced Source "${cfg.name}" collectorId: ${existing.collectorId} -> ${cfg.collectorId}`);
    }
  }

  return space;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "retrace-backend" });
});

app.get("/api/sources", async (req, res) => {
  try {
    const rows = await getSourcesWithHealth(prisma);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/collect/:sourceName
 * body: { topic?: string }
 *
 * Checkpoint-A endpoint: trigger the named collector, store the raw response
 * untouched, and record a Collection row. No normalization yet — that's Phase 2/3.
 */
app.post("/api/collect/:sourceName", async (req, res) => {
  const { sourceName } = req.params;
  const cfg = sources[sourceName];
  if (!cfg) {
    return res.status(404).json({ error: `Unknown source "${sourceName}". Known: ${Object.keys(sources).join(", ")}` });
  }
  if (!cfg.collectorId) {
    return res.status(400).json({
      error: `No collector ID configured for "${sourceName}". Run bdata scraper create for it, then set BRIGHTDATA_${sourceName.toUpperCase()}_COLLECTOR_ID in backend/.env.`,
    });
  }

  const topic = req.body.topic || DEFAULT_TOPIC;
  const sourceRow = await prisma.source.findFirst({ where: { name: sourceName } });

  const collection = await prisma.collection.create({
    data: { sourceId: sourceRow.id, status: "RUNNING" },
  });

  try {
    const input = resolveSourceInput(cfg, topic);
    const { snapshotId, records } = await runCollector(cfg.collectorId, [input]);

    const filePath = path.join(RAW_DIR, `${collection.id}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ collectionId: collection.id, sourceId: sourceRow.id, snapshotId, topic, records }, null, 2)
    );

    await prisma.collection.update({
      where: { id: collection.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
        recordCount: Array.isArray(records) ? records.length : 0,
        rawFilePath: filePath,
      },
    });

    await prisma.source.update({
      where: { id: sourceRow.id },
      data: { status: "HEALTHY", lastRun: new Date(), lastSuccessAt: new Date() },
    });

    res.json({ collectionId: collection.id, recordCount: records.length, rawFilePath: filePath });
  } catch (err) {
    await prisma.collection.update({
      where: { id: collection.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: String(err.message || err) },
    });
    await prisma.source.update({
      where: { id: sourceRow.id },
      data: { status: "EXTRACTION_FAILED" },
    });

    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 5000;

ensureSeeded()
  .then(() => {
    app.listen(PORT, () => console.log(`ReTrace backend listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to seed database on startup:", err);
    process.exit(1);
  });