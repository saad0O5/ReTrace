// Exports everything currently in the database into a plain JS file the
// dashboard can load with a simple <script> tag - no server, no build step,
// no CORS issues from opening an HTML file directly.
//
// Usage: node scripts/exportDashboard.js
// Re-run this any time the DB changes and refresh the dashboard in the browser.

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const fs = require("fs");
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));

const { getSourcesWithHealth } = require("../backend/src/database/sourceHealth");
const { getLatestSignals } = require("../backend/src/analysis/signalService");
const { compareCollections } = require("../backend/src/analysis/changeDetector");
const { buildResearchLandscapeReport } = require("../backend/src/analysis/researchAnalytics");

const prisma = new PrismaClient();

function parseEvidence(value) {
  try {
    return JSON.parse(value || "[]");
  } catch (_) {
    return [];
  }
}

async function main() {
  const space = await prisma.researchSpace.findFirst();
  const sources = await getSourcesWithHealth(prisma);
  const artifacts = await prisma.artifact.findMany({
    include: {
      versions: true,
    },
    orderBy: { publishedAt: "desc" },
  });
  const relationships = await prisma.relationship.findMany({
    include: {
      sourceArtifact: true,
      targetArtifact: true,
    },
    orderBy: { confidence: "desc" },
  });

  const overview = {};
  for (const a of artifacts) {
    overview[a.type] = (overview[a.type] || 0) + 1;
  }

  // Calculate change summary and source deltas from consecutive collections
  const signals = space ? await getLatestSignals(space.id, prisma, 50) : [];
  const sourceDeltas = {};
  let totalNew = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalUnchanged = 0;
  let hasScansWithDelta = false;

  for (const src of sources) {
    const successfulCollections = await prisma.collection.findMany({
      where: { sourceId: src.id, status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
    });

    if (successfulCollections.length >= 2) {
      hasScansWithDelta = true;
      const comp = await compareCollections(successfulCollections[1], successfulCollections[0], prisma);
      if (comp.eligible) {
        sourceDeltas[src.name] = comp.summary;
        totalNew += comp.summary.new;
        totalUpdated += comp.summary.updated;
        totalRemoved += comp.summary.removed;
        totalUnchanged += comp.summary.unchanged;
      }
    } else {
      sourceDeltas[src.name] = {
        new: 0,
        updated: 0,
        removed: 0,
        unchanged: successfulCollections[0]?.recordCount || 0,
        baselineOnly: true,
      };
    }
  }

  const changes = {
    new: totalNew,
    updated: totalUpdated,
    removed: totalRemoved,
    unchanged: totalUnchanged,
    hasComparison: hasScansWithDelta,
    signalsCount: signals.length,
  };

  const analytics = buildResearchLandscapeReport({
    artifacts,
    relationships,
    sources,
    signals,
  });

  const data = {
    generatedAt: new Date().toISOString(),
    researchSpace: space ? { name: space.name, topic: space.topic } : null,
    sources: sources.map((s) => ({
      name: s.name,
      collectorId: s.collectorId,
      status: s.status,
      lastRun: s.lastRun,
      lastSuccessAt: s.lastSuccessAt,
      recordCount: s.recordCount,
      errorMessage: s.errorMessage,
    })),
    overview,
    totalArtifacts: artifacts.length,
    totalVersions: artifacts.reduce((sum, a) => sum + (a.versions?.length || 1), 0),
    changes,
    sourceDeltas,
    signals,
    relationships: relationships.map((r) => ({
      paperTitle: r.sourceArtifact.title,
      paperUrl: r.sourceArtifact.url,
      repoTitle: r.targetArtifact.title,
      repoUrl: r.targetArtifact.url,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
      evidence: parseEvidence(r.evidence),
    })),
    artifacts: artifacts.map((a) => {
      let meta = {};
      try {
        meta = JSON.parse(a.metadata || "{}");
      } catch (_) {
        meta = {};
      }
      return {
        id: a.id,
        title: a.title,
        type: a.type,
        url: a.url,
        rawUrl: meta.rawUrl || a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        firstSeen: a.firstSeen,
        lastSeen: a.lastSeen,
        versionsCount: a.versions ? a.versions.length : 1,
        authors: meta.authors || [],
        abstract: a.description || null,
      };
    }),
    analytics,
  };

  const outDir = path.join(__dirname, "..", "frontend");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "dashboard-data.js");
  fs.writeFileSync(outPath, `window.RETRACE_DATA = ${JSON.stringify(data, null, 2)};\n`);

  console.log(`Exported ${artifacts.length} artifacts to ${outPath}`);
  console.log(`Exported ${relationships.length} relationships`);
  console.log(`Overview: ${JSON.stringify(overview)}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Export failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
