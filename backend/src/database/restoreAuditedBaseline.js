const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { normalizeUrl } = require("../ingestion/urlNormalizer");
const { buildSnapshotPayload, computeContentHash } = require("../ingestion/snapshot");

const prisma = new PrismaClient();

async function restore() {
  console.log("Checking database state...");
  const existingCount = await prisma.artifact.count();
  if (existingCount >= 174) {
    console.log(`Database already has ${existingCount} artifacts. No restoration needed.`);
    await prisma.$disconnect();
    return;
  }

  console.log("Loading audited data from frontend/dashboard-data.js...");
  const dataPath = path.join(__dirname, "..", "..", "..", "frontend", "dashboard-data.js");
  const code = fs.readFileSync(dataPath, "utf-8");
  const sandbox = {};
  new Function("window", code)(sandbox);
  const data = sandbox.RETRACE_DATA;

  if (!data || !Array.isArray(data.artifacts)) {
    throw new Error("Could not parse RETRACE_DATA from dashboard-data.js");
  }

  console.log(`Loaded ${data.artifacts.length} artifacts, ${data.relationships.length} relationships.`);

  // 1. Create or find ResearchSpace
  let space = await prisma.researchSpace.findFirst({
    where: { name: data.researchSpace?.name || "OTFS Channel Estimation" },
  });
  if (!space) {
    space = await prisma.researchSpace.create({
      data: {
        name: data.researchSpace?.name || "OTFS Channel Estimation",
        topic: data.researchSpace?.topic || "OTFS channel estimation",
        description: "OTFS modulation and channel estimation research landscape",
      },
    });
    console.log(`Created ResearchSpace: ${space.id}`);
  }

  // 2. Create Sources
  const sourceRows = {};
  const sourceConfigs = [
    {
      name: "arxiv",
      baseUrl: "https://arxiv.org/search/?query={topic}",
      collectorId: "c_mt4ot19f1crygiarf6",
      status: "CONFIGURED",
      artifactTypes: "PAPER",
      lastRun: null,
      lastSuccessAt: null,
    },
    {
      name: "github",
      baseUrl: "https://github.com/search?q={topic}&type=repositories",
      collectorId: "c_mt5yn9lvrgrgdp5vm",
      status: "HEALTHY",
      artifactTypes: "IMPLEMENTATION",
      lastRun: new Date("2026-08-23T17:08:14.604Z"),
      lastSuccessAt: new Date("2026-08-23T17:08:14.604Z"),
    },
    {
      name: "fixture",
      baseUrl: "https://saad0o5.github.io/ReTrace-Fixture/",
      collectorId: "c_mt5c4xao29ue6pvc89",
      status: "TEST SOURCE",
      artifactTypes: "PAPER",
      lastRun: null,
      lastSuccessAt: null,
    },
  ];

  for (const cfg of sourceConfigs) {
    let src = await prisma.source.findFirst({
      where: { researchSpaceId: space.id, name: cfg.name },
    });
    if (!src) {
      src = await prisma.source.create({
        data: {
          researchSpaceId: space.id,
          name: cfg.name,
          baseUrl: cfg.baseUrl,
          collectorId: cfg.collectorId,
          status: cfg.status,
          artifactTypes: cfg.artifactTypes,
          lastRun: cfg.lastRun,
          lastSuccessAt: cfg.lastSuccessAt,
        },
      });
      console.log(`Created Source: ${src.name}`);
    }
    sourceRows[cfg.name] = src;
  }

  // 3. Create Collections for arXiv and GitHub
  let arxivCollection = await prisma.collection.findFirst({
    where: { sourceId: sourceRows.arxiv.id },
  });
  if (!arxivCollection) {
    arxivCollection = await prisma.collection.create({
      data: {
        sourceId: sourceRows.arxiv.id,
        status: "SUCCESS",
        recordCount: 164,
        startedAt: new Date("2026-08-23T16:50:00.000Z"),
        completedAt: new Date("2026-08-23T16:55:00.000Z"),
        rawFilePath: "backend/raw/manual-arxiv-1787499100000.json",
      },
    });
  }

  let githubCollection = await prisma.collection.findFirst({
    where: { sourceId: sourceRows.github.id },
  });
  if (!githubCollection) {
    githubCollection = await prisma.collection.create({
      data: {
        sourceId: sourceRows.github.id,
        status: "SUCCESS",
        recordCount: 10,
        startedAt: new Date("2026-08-23T17:08:00.000Z"),
        completedAt: new Date("2026-08-23T17:08:14.604Z"),
        rawFilePath: "backend/raw/manual-github-1787499165338.json",
      },
    });
  }

  // 4. Ingest Artifacts & Versions
  const urlToArtifact = new Map();
  let paperCount = 0;
  let repoCount = 0;

  for (const item of data.artifacts) {
    const rawUrl = item.url;
    const canonicalUrl = normalizeUrl(rawUrl) || rawUrl;
    const type = item.type;
    const isPaper = type === "PAPER";
    const sourceName = isPaper ? "arxiv" : "github";
    const collection = isPaper ? arxivCollection : githubCollection;

    let metadataObj = {};
    if (isPaper) {
      const arxivIdMatch = canonicalUrl.match(/\/abs\/([^/?#]+)/);
      const arxivId = arxivIdMatch ? arxivIdMatch[1] : null;
      metadataObj = {
        authors: item.authors || [],
        arxivId,
        rawArxivId: arxivId,
        rawUrl,
      };
      paperCount++;
    } else {
      let owner = "unknown";
      try {
        const u = new URL(canonicalUrl);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length >= 1) owner = parts[0];
      } catch (_) {}
      metadataObj = {
        owner,
        repository: canonicalUrl,
        rawUrl,
        language: null,
        stars: null,
        lastUpdated: null,
      };
      repoCount++;
    }

    const artifactData = {
      researchSpaceId: space.id,
      type,
      title: item.title,
      description: item.description || null,
      url: canonicalUrl,
      source: sourceName,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
      metadata: JSON.stringify(metadataObj),
    };

    let existingArtifact = await prisma.artifact.findFirst({
      where: { researchSpaceId: space.id, url: canonicalUrl },
    });

    let savedArtifact = existingArtifact;
    if (!savedArtifact) {
      savedArtifact = await prisma.artifact.create({ data: artifactData });
    }

    urlToArtifact.set(canonicalUrl, savedArtifact);
    urlToArtifact.set(rawUrl, savedArtifact);

    // ArtifactVersion
    const snapshotPayload = buildSnapshotPayload(artifactData);
    const contentHash = computeContentHash(snapshotPayload);

    const existingVersion = await prisma.artifactVersion.findFirst({
      where: { artifactId: savedArtifact.id },
    });

    if (!existingVersion) {
      await prisma.artifactVersion.create({
        data: {
          artifactId: savedArtifact.id,
          collectionId: collection.id,
          contentHash,
          metadata: JSON.stringify(snapshotPayload),
          observedAt: collection.completedAt || new Date(),
        },
      });
    }
  }

  console.log(`Inserted artifacts: ${paperCount} papers, ${repoCount} repos (total: ${paperCount + repoCount})`);

  // 5. Ingest Relationships
  let relCreated = 0;
  for (const rel of data.relationships) {
    const paperCanonicalUrl = normalizeUrl(rel.paperUrl) || rel.paperUrl;
    const repoCanonicalUrl = normalizeUrl(rel.repoUrl) || rel.repoUrl;

    const paperArtifact = urlToArtifact.get(paperCanonicalUrl) || urlToArtifact.get(rel.paperUrl);
    const repoArtifact = urlToArtifact.get(repoCanonicalUrl) || urlToArtifact.get(rel.repoUrl);

    if (!paperArtifact || !repoArtifact) {
      console.warn(`Could not link relationship: "${rel.paperTitle}" <-> "${rel.repoTitle}"`);
      continue;
    }

    const existingRel = await prisma.relationship.findFirst({
      where: {
        sourceArtifactId: paperArtifact.id,
        targetArtifactId: repoArtifact.id,
        relationshipType: rel.relationshipType || "IMPLEMENTED_BY",
      },
    });

    if (!existingRel) {
      await prisma.relationship.create({
        data: {
          sourceArtifactId: paperArtifact.id,
          targetArtifactId: repoArtifact.id,
          relationshipType: rel.relationshipType || "IMPLEMENTED_BY",
          confidence: Number(rel.confidence),
          evidence: JSON.stringify(rel.evidence || []),
        },
      });
      relCreated++;
    }
  }

  console.log(`Restored ${relCreated} relationships.`);
  await prisma.$disconnect();
}

restore().catch(async (err) => {
  console.error("Restoration error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
