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
const { getScheduleConfig, scheduleRecurringRuns } = require("./scheduler");
const { runPipeline, getChangeSummary } = require("./services/pipelineService");

const app = express();
app.use(cors());
app.use(express.json());

const RAW_DIR = path.join(__dirname, "..", "raw");
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

const DEFAULT_SPACE_NAME = process.env.RETRACE_SPACE_NAME || "OTFS Channel Estimation";
const DEFAULT_TOPIC = process.env.RETRACE_TOPIC || "OTFS channel estimation";

// ─── Seed ───────────────────────────────────────────────────────────────────

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
      await prisma.source.update({
        where: { id: existing.id },
        data: { collectorId: cfg.collectorId, baseUrl: cfg.urlTemplate },
      });
      console.log(`Synced Source "${cfg.name}" collectorId: ${existing.collectorId} -> ${cfg.collectorId}`);
    }
  }
  return space;
}

// ─── Health ─────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "retrace-backend" });
});

// ─── Sources ────────────────────────────────────────────────────────────────

app.get("/api/sources", async (req, res) => {
  try {
    const rows = await getSourcesWithHealth(prisma);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Collections ────────────────────────────────────────────────────────────

app.get("/api/collections", async (req, res) => {
  try {
    const { sourceName, limit = 50 } = req.query;
    const where = { status: "SUCCESS" };
    if (sourceName) {
      const source = await prisma.source.findFirst({ where: { name: sourceName } });
      if (source) where.sourceId = source.id;
    }
    const collections = await prisma.collection.findMany({
      where,
      include: { source: true },
      orderBy: { startedAt: "desc" },
      take: Number(limit) || 50,
    });
    res.json(collections.map((c) => ({
      id: c.id,
      sourceName: c.source.name,
      sourceId: c.sourceId,
      status: c.status,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      recordCount: c.recordCount,
      errorMessage: c.errorMessage,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Artifacts (search + filter + pagination) ──────────────────────────────

app.get("/api/artifacts", async (req, res) => {
  try {
    const { search, type, source, sort = "newest", page = 1, limit = 50 } = req.query;
    const where = {};

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
      ];
    }
    if (type) where.type = type.toUpperCase();
    if (source) where.source = source.toLowerCase();

    const orderBy = sort === "oldest"
      ? { firstSeen: "asc" }
      : sort === "title"
      ? { title: "asc" }
      : { lastSeen: "desc" };

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));

    const [total, artifacts] = await Promise.all([
      prisma.artifact.count({ where }),
      prisma.artifact.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        include: { versions: true },
      }),
    ]);

    res.json({
      artifacts: artifacts.map((a) => {
        let meta = {};
        try { meta = JSON.parse(a.metadata || "{}"); } catch (_) { meta = {}; }
        return {
          id: a.id,
          title: a.title,
          type: a.type,
          url: a.url,
          source: a.source,
          publishedAt: a.publishedAt,
          firstSeen: a.firstSeen,
          lastSeen: a.lastSeen,
          description: a.description || meta.abstract || null,
          authors: meta.authors || [],
          metadata: meta,
          versionsCount: a.versions ? a.versions.length : 1,
          notes: a.notes || null,
          reviewedAt: a.reviewedAt || null,
        };
      }),
      pagination: { page: pageNum, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
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
    try { meta = JSON.parse(artifact.metadata || "{}"); } catch (_) { meta = {}; }

    res.json({
      ...artifact,
      metadata: meta,
      description: artifact.description || meta.abstract || null,
      relationshipsFrom: artifact.relationshipsFrom.map((r) => ({
        ...r,
        evidence: (() => { try { return JSON.parse(r.evidence || "[]"); } catch (_) { return []; } })(),
      })),
      relationshipsTo: artifact.relationshipsTo.map((r) => ({
        ...r,
        evidence: (() => { try { return JSON.parse(r.evidence || "[]"); } catch (_) { return []; } })(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Changes ────────────────────────────────────────────────────────────────

app.get("/api/changes", async (req, res) => {
  try {
    const { type, sourceName, limit = 100 } = req.query;
    const where = {};
    if (type) where.type = type.toUpperCase();

    const signals = await prisma.researchSignal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(limit) || 100,
    });

    const parsed = signals.map((s) => {
      let ev = {};
      try { ev = JSON.parse(s.evidence || "{}"); } catch (_) { ev = {}; }
      return {
        id: s.id,
        type: s.type,
        title: s.title,
        description: s.description,
        severity: s.severity,
        createdAt: s.createdAt,
        sourceName: ev.sourceName || "unknown",
        url: ev.url || null,
        artifactType: ev.type || null,
        changes: ev.changes || [],
        evidence: ev,
      };
    });

    const filtered = sourceName
      ? parsed.filter((s) => s.sourceName === sourceName)
      : parsed;

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Dashboard ──────────────────────────────────────────────────────────────

async function getDashboardPayload() {
  const space = await prisma.researchSpace.findFirst();
  const sourcesRows = await getSourcesWithHealth(prisma);
  const artifacts = await prisma.artifact.findMany({
    include: { versions: true },
    orderBy: { publishedAt: "desc" },
  });
  const relationships = await prisma.relationship.findMany({
    include: { sourceArtifact: true, targetArtifact: true },
    orderBy: { confidence: "desc" },
  });
  const signals = space ? await getLatestSignals(space.id, prisma, 50) : [];
  const analytics = buildResearchLandscapeReport({ artifacts, relationships, sources: sourcesRows, signals });
  const changes = space
    ? await getChangeSummary(prisma, space.id)
    : { new: 0, updated: 0, removed: 0, unchanged: 0, hasComparison: false, signalsCount: 0 };

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
    totalVersions: artifacts.reduce((sum, a) => sum + (a.versions?.length || 1), 0),
    changes,
    artifacts: artifacts.map((a) => {
      let meta = {};
      try { meta = JSON.parse(a.metadata || "{}"); } catch (_) { meta = {}; }
      return {
        id: a.id,
        title: a.title,
        type: a.type,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        firstSeen: a.firstSeen,
        lastSeen: a.lastSeen,
        description: a.description || meta.abstract || null,
        authors: meta.authors || [],
        metadata: meta,
        versionsCount: a.versions ? a.versions.length : 1,
        rawUrl: meta.rawUrl || a.url,
        notes: a.notes || null,
        reviewedAt: a.reviewedAt || null,
      };
    }),
    relationships: relationships.map((r) => ({
      id: r.id,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
      evidence: (() => { try { return JSON.parse(r.evidence || "[]"); } catch (_) { return []; } })(),
      sourceArtifactId: r.sourceArtifactId,
      targetArtifactId: r.targetArtifactId,
      sourceArtifact: r.sourceArtifact ? { id: r.sourceArtifact.id, title: r.sourceArtifact.title, type: r.sourceArtifact.type, url: r.sourceArtifact.url } : null,
      targetArtifact: r.targetArtifact ? { id: r.targetArtifact.id, title: r.targetArtifact.title, type: r.targetArtifact.type, url: r.targetArtifact.url } : null,
      paperTitle: r.sourceArtifact ? r.sourceArtifact.title : null,
      repoTitle: r.targetArtifact ? r.targetArtifact.title : null,
      paperUrl: r.sourceArtifact ? r.sourceArtifact.url : null,
      repoUrl: r.targetArtifact ? r.targetArtifact.url : null,
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

// ─── Artifact notes & review ────────────────────────────────────────────────

app.patch("/api/artifacts/:id", async (req, res) => {
  try {
    const { notes, reviewedAt, dismissed } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (reviewedAt !== undefined) data.reviewedAt = reviewedAt ? new Date(reviewedAt) : null;
    if (dismissed === true) {
      data.reviewedAt = new Date();
      data.notes = (data.notes || '') + (data.notes ? '\n' : '') + '[dismissed]';
    }
    const artifact = await prisma.artifact.update({ where: { id: req.params.id }, data });
    res.json({ success: true, artifact: { id: artifact.id, notes: artifact.notes, reviewedAt: artifact.reviewedAt } });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Export ──────────────────────────────────────────────────────────────────

app.get("/api/export", async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const artifacts = await prisma.artifact.findMany({
      include: { versions: { orderBy: { observedAt: 'desc' }, take: 1 } },
      orderBy: { publishedAt: 'desc' },
    });

    if (format === 'csv') {
      const header = 'id,type,title,description,url,source,publishedAt,firstSeen,lastSeen,versionsCount,notes';
      const rows = artifacts.map((a) => {
        const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        return [a.id, a.type, esc(a.title), esc(a.description || ''), a.url, a.source,
          a.publishedAt || '', a.firstSeen, a.lastSeen, a.versions?.length || 1, esc(a.notes || '')].join(',');
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=retrace-export.csv');
      return res.send(header + '\n' + rows.join('\n'));
    }

    if (format === 'bibtex') {
      const entries = artifacts.filter((a) => a.type === 'PAPER').map((a) => {
        let meta = {};
        try { meta = JSON.parse(a.metadata || '{}'); } catch (_) { meta = {}; }
        const key = a.id.slice(0, 12);
        const authors = (meta.authors || []).join(' and ') || 'Unknown';
        const year = a.publishedAt ? new Date(a.publishedAt).getFullYear() : '';
        return `@article{${key},\n  title = {${a.title}},\n  author = {${authors}},\n  year = {${year}},\n  url = {${a.url}},\n  note = {Retrieved by ReTrace}\n}`;
      });
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename=retrace-export.bib');
      return res.send(entries.join('\n\n'));
    }

    // Default: JSON
    const payload = artifacts.map((a) => {
      let meta = {};
      try { meta = JSON.parse(a.metadata || '{}'); } catch (_) { meta = {}; }
      return {
        id: a.id, type: a.type, title: a.title, description: a.description,
        url: a.url, source: a.source, publishedAt: a.publishedAt,
        firstSeen: a.firstSeen, lastSeen: a.lastSeen,
        authors: meta.authors || [], metadata: meta,
        versionsCount: a.versions?.length || 1, notes: a.notes, reviewedAt: a.reviewedAt,
      };
    });
    res.setHeader('Content-Disposition', 'attachment; filename=retrace-export.json');
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── Collection trigger (single) ────────────────────────────────────────────

app.post("/api/collect/:sourceName", async (req, res) => {
  const { sourceName } = req.params;
  const cfg = sources[sourceName];
  if (!cfg) {
    return res.status(404).json({ error: `Unknown source "${sourceName}". Known: ${Object.keys(sources).join(", ")}` });
  }

  const sourceRow = await prisma.source.findFirst({ where: { name: sourceName } });
  if (!sourceRow) {
    return res.status(404).json({ error: `Source "${sourceName}" not found in database. Restart server to seed it.` });
  }

  const collection = await prisma.collection.create({
    data: { sourceId: sourceRow.id, status: "RUNNING" },
  });

  try {
    if (!cfg.collectorId) {
      throw new Error(`No collector ID configured for "${sourceName}".`);
    }
    const topic = req.body.topic || DEFAULT_TOPIC;
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
      data: { status: sourceStatus, lastRun: new Date(), lastSuccessAt: recordCount > 0 ? new Date() : null },
    });

    // Run the full pipeline: normalize -> version -> compare -> signals
    const pipelineResult = await runPipeline(prisma, collection.id);

    res.json({
      collectionId: collection.id,
      recordCount,
      rawFilePath: filePath,
      sourceStatus,
      pipeline: pipelineResult,
    });
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

// ─── Static frontend (single-origin deployment) ──────────────────────────────
//
// Serves the built React frontend from the same Express process so there's no
// cross-origin fetch. All /api/* routes above take precedence; everything else
// falls through to the SPA's index.html so client-side routing works correctly.
//
// In development: frontend/dist may not exist; the catch-all gracefully 404s.
// In production (Docker): the Dockerfile builds the frontend into frontend/dist
// before starting this server — the directory will always exist.

const FRONTEND_DIST = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get("*", (req, res) => {
    // Only handle non-API requests (API 404s should remain 404s, not serve HTML)
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API route not found" });
    }
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  console.log(`Serving static frontend from ${FRONTEND_DIST}`);
} else {
  console.log("frontend/dist not found — run 'npm run build' in frontend/ to enable static serving.");
}

// ─── Server start ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

ensureSeeded()
  .then(() => {
    const scheduleConfig = getScheduleConfig();
    if (scheduleConfig.enabled) {
      const timer = scheduleRecurringRuns({
        enabled: true,
        intervalMs: scheduleConfig.intervalMs,
        onTick: async () => {
          console.log(`Scheduled scan tick: ${scheduleConfig.sources.join(", ")}`);
          for (const sourceName of scheduleConfig.sources) {
            const cfg = sources[sourceName];
            if (!cfg) continue;
            try {
              const sourceRow = await prisma.source.findFirst({ where: { name: sourceName } });
              if (!sourceRow || !cfg.collectorId) continue;
              const collection = await prisma.collection.create({
                data: { sourceId: sourceRow.id, status: "RUNNING" },
              });
              const { snapshotId, records } = await runCollector(cfg.collectorId, [resolveSourceInput(cfg, scheduleConfig.topic)]);
              const filePath = path.join(RAW_DIR, `${collection.id}.json`);
              fs.writeFileSync(
                filePath,
                JSON.stringify({ collectionId: collection.id, sourceId: sourceRow.id, snapshotId, topic: scheduleConfig.topic, records }, null, 2)
              );
              await prisma.collection.update({
                where: { id: collection.id },
                data: { status: "SUCCESS", completedAt: new Date(), recordCount: Array.isArray(records) ? records.length : 0, rawFilePath: filePath },
              });
              await prisma.source.update({
                where: { id: sourceRow.id },
                data: {
                  status: (Array.isArray(records) && records.length > 0) ? "HEALTHY" : "DRIFTING",
                  lastRun: new Date(),
                  lastSuccessAt: (Array.isArray(records) && records.length > 0) ? new Date() : null,
                },
              });
              // Run pipeline after scheduled collection
              await runPipeline(prisma, collection.id);
            } catch (err) {
              console.error(`Scheduled collection failed for ${sourceName}:`, err.message || err);
            }
          }
        },
      });
      if (timer) console.log(`Scheduler enabled: scanning ${scheduleConfig.sources.join(", ")} every ${scheduleConfig.intervalMs} ms`);
    } else {
      console.log("Scheduler disabled; set RETRACE_SCHEDULE_ENABLED=true to enable periodic scans.");
    }
    app.listen(PORT, () => console.log(`ReTrace backend listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to seed database on startup:", err);
    process.exit(1);
  });
