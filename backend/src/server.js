require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { prisma } = require("./database/client");
const { getSourcesWithHealth } = require("./database/sourceHealth");
const { runCollector } = require("./collectors/brightdata");
const { sources, resolveSourceInput } = require("./collectors/sources.config");
const { getLatestSignals } = require("./analysis/signalService");
const { buildResearchLandscapeReport } = require("./analysis/researchAnalytics");

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

async function getDashboardPayload() {
  const space = await prisma.researchSpace.findFirst();
  const sourcesRows = await getSourcesWithHealth(prisma);
  const artifacts = await prisma.artifact.findMany({
    include: { versions: true },
    orderBy: { publishedAt: "desc" },
  });
  const relationships = await prisma.relationship.findMany({
    include: {
      sourceArtifact: true,
      targetArtifact: true,
    },
    orderBy: { confidence: "desc" },
  });
  const signals = space ? await getLatestSignals(space.id, prisma, 50) : [];
  const analytics = buildResearchLandscapeReport({ artifacts, relationships, sources: sourcesRows, signals });

  const overview = {};
  for (const artifact of artifacts) {
    overview[artifact.type] = (overview[artifact.type] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    researchSpace: space ? { name: space.name, topic: space.topic } : null,
    sources: sourcesRows.map((source) => ({
      id: source.id,
      name: source.name,
      collectorId: source.collectorId,
      status: source.status,
      lastRun: source.lastRun,
      lastSuccessAt: source.lastSuccessAt,
      recordCount: source.recordCount,
      errorMessage: source.errorMessage,
      artifactTypes: source.artifactTypes,
    })),
    overview,
    totalArtifacts: artifacts.length,
    totalVersions: artifacts.reduce((sum, artifact) => sum + (artifact.versions?.length || 1), 0),
    changes: {
      new: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      hasComparison: false,
      signalsCount: signals.length,
    },
    artifacts: artifacts.map((artifact) => {
      let meta = {};
      try {
        meta = JSON.parse(artifact.metadata || "{}");
      } catch (_) {
        meta = {};
      }
      return {
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        url: artifact.url,
        source: artifact.source,
        publishedAt: artifact.publishedAt,
        firstSeen: artifact.firstSeen,
        lastSeen: artifact.lastSeen,
        description: artifact.description || meta.abstract || null,
        authors: meta.authors || [],
        metadata: meta,
        versionsCount: artifact.versions ? artifact.versions.length : 1,
        rawUrl: meta.rawUrl || artifact.url,
      };
    }),
    relationships: relationships.map((relationship) => ({
      id: relationship.id,
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
      evidence: (() => {
        try {
          return JSON.parse(relationship.evidence || "[]");
        } catch (_) {
          return [];
        }
      })(),
      sourceArtifactId: relationship.sourceArtifactId,
      targetArtifactId: relationship.targetArtifactId,
      sourceArtifact: relationship.sourceArtifact ? {
        id: relationship.sourceArtifact.id,
        title: relationship.sourceArtifact.title,
        type: relationship.sourceArtifact.type,
        url: relationship.sourceArtifact.url,
      } : null,
      targetArtifact: relationship.targetArtifact ? {
        id: relationship.targetArtifact.id,
        title: relationship.targetArtifact.title,
        type: relationship.targetArtifact.type,
        url: relationship.targetArtifact.url,
      } : null,
      paperTitle: relationship.sourceArtifact ? relationship.sourceArtifact.title : null,
      repoTitle: relationship.targetArtifact ? relationship.targetArtifact.title : null,
      paperUrl: relationship.sourceArtifact ? relationship.sourceArtifact.url : null,
      repoUrl: relationship.targetArtifact ? relationship.targetArtifact.url : null,
    })),
    signals,
    analytics,
  };
}

app.get("/api/dashboard", async (req, res) => {
  try {
    const payload = await getDashboardPayload();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/artifacts/:id", async (req, res) => {
  try {
    const artifact = await prisma.artifact.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          include: { collection: { include: { source: true } } },
          orderBy: { observedAt: "desc" },
        },
        relationshipsFrom: { include: { targetArtifact: true } },
        relationshipsTo: { include: { sourceArtifact: true } },
      },
    });
    if (!artifact) return res.status(404).json({ error: "Artifact not found" });

    let meta = {};
    try {
      meta = JSON.parse(artifact.metadata || "{}");
    } catch (_) {
      meta = {};
    }

    res.json({
      ...artifact,
      metadata: meta,
      description: artifact.description || meta.abstract || null,
      relationshipsFrom: artifact.relationshipsFrom.map((relationship) => ({
        ...relationship,
        evidence: (() => {
          try {
            return JSON.parse(relationship.evidence || "[]");
          } catch (_) {
            return [];
          }
        })(),
      })),
      relationshipsTo: artifact.relationshipsTo.map((relationship) => ({
        ...relationship,
        evidence: (() => {
          try {
            return JSON.parse(relationship.evidence || "[]");
          } catch (_) {
            return [];
          }
        })(),
      })),
    });
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

    const recordCount = Array.isArray(records) ? records.length : 0;
    const sourceStatus = recordCount > 0 ? "HEALTHY" : "DRIFTING";

    await prisma.source.update({
      where: { id: sourceRow.id },
      data: {
        status: sourceStatus,
        lastRun: new Date(),
        lastSuccessAt: recordCount > 0 ? new Date() : null,
      },
    });

    res.json({ collectionId: collection.id, recordCount, rawFilePath: filePath, sourceStatus });
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