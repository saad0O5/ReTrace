// ReTrace Pipeline Service — orchestrates the full post-collection flow:
//   raw JSON → normalize → upsert artifacts → create versions →
//   compare with previous baseline → generate signals → match relationships
//
// This is the integration layer that was previously missing. After a
// successful collection, the server (or scheduler) calls runPipeline()
// and the entire downstream chain executes automatically.

const fs = require("fs");
const path = require("path");
const { normalizeArxivRecord, normalizeGithubRecord, normalizeCalderbankRecord } = require("../ingestion/normalizer");
const { buildSnapshotPayload, computeContentHash } = require("../ingestion/snapshot");
const { normalizeUrl } = require("../ingestion/urlNormalizer");
const { compareCollections } = require("../analysis/changeDetector");
const { generateSignalsFromComparison } = require("../analysis/signalService");
const { matchRelationships } = require("../matching/resolver");
const { filterByTopicRelevance } = require("../ingestion/topicFilter");

// Sources that require topic-relevance filtering at ingestion time.
// Faculty publication pages return an author's full career output; we only
// want artifacts relevant to the configured research topic.
const TOPIC_FILTERED_SOURCES = new Set(["duke-calderbank"]);

const NORMALIZERS = {
  arxiv: normalizeArxivRecord,
  github: normalizeGithubRecord,
  "duke-calderbank": normalizeCalderbankRecord,
};

/**
 * Reads raw records from a collection's rawFilePath or from inline records array.
 * @param {object} collection - Collection record from Prisma
 * @returns {object[]} Raw record array
 */
function loadRawRecords(collection) {
  if (!collection.rawFilePath) return [];
  try {
    const resolvedPath = path.isAbsolute(collection.rawFilePath)
      ? collection.rawFilePath
      : path.join(__dirname, "..", "..", "..", collection.rawFilePath);
    if (!fs.existsSync(resolvedPath)) return [];
    const content = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
    return Array.isArray(content) ? content : Array.isArray(content.records) ? content.records : [];
  } catch (_) {
    return [];
  }
}

/**
 * Normalizes, deduplicates, and upserts artifacts from a collection into the DB.
 * Creates ArtifactVersion records with content hashes for change tracking.
 *
 * @param {object} prismaClient
 * @param {object} collection - Collection DB record
 * @param {object} source - Source DB record
 * @param {string} sourceName - e.g. "arxiv", "github", "duke-calderbank"
 * @returns {Promise<{created: number, updated: number, unchanged: number, failed: number, normalized: object[]}>}
 */
async function ingestCollection(prismaClient, collection, source, sourceName) {
  const normalizer = NORMALIZERS[sourceName];
  if (!normalizer) {
    return { created: 0, updated: 0, unchanged: 0, failed: 0, normalized: [] };
  }

  const rawRecords = loadRawRecords(collection);
  if (rawRecords.length === 0) {
    return { created: 0, updated: 0, unchanged: 0, failed: 0, normalized: [] };
  }

  const spaceId = source.researchSpaceId;
  const failedRecords = [];

  let normalized = rawRecords
    .map((r) => {
      try {
        return normalizer(r);
      } catch (err) {
        failedRecords.push({ error: err.message });
        return null;
      }
    })
    .filter(Boolean);

  // Apply topic relevance filter for sources that collect full author output
  // rather than topic-specific queries (e.g. faculty publication pages).
  let filteredOut = 0;
  if (TOPIC_FILTERED_SOURCES.has(sourceName)) {
    const { kept, rejected } = filterByTopicRelevance(normalized);
    filteredOut = rejected.length;
    normalized = kept.map(({ _relevance, ...rest }) => rest); // strip internal field
    if (filteredOut > 0) {
      console.log(`[${sourceName}] Topic filter: ${normalized.length} kept, ${filteredOut} filtered as off-topic`);
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const artifact of normalized) {
    const canonicalUrl = normalizeUrl(artifact.url) || artifact.url;
    const existing = await prismaClient.artifact.findFirst({
      where: { researchSpaceId: spaceId, url: canonicalUrl },
    });

    const snapshotPayload = buildSnapshotPayload(artifact);
    const contentHash = computeContentHash(snapshotPayload);

    if (existing) {
      const latestVersion = await prismaClient.artifactVersion.findFirst({
        where: { artifactId: existing.id },
        orderBy: { observedAt: "desc" },
      });

      if (!latestVersion || latestVersion.contentHash !== contentHash) {
        await prismaClient.artifactVersion.create({
          data: {
            artifactId: existing.id,
            collectionId: collection.id,
            contentHash,
            metadata: JSON.stringify(snapshotPayload),
          },
        });
        await prismaClient.artifact.update({
          where: { id: existing.id },
          data: {
            title: artifact.title,
            description: artifact.description,
            publishedAt: artifact.publishedAt,
            metadata: artifact.metadata,
            lastSeen: new Date(),
            updatedAt: new Date(),
          },
        });
        updated++;
      } else {
        await prismaClient.artifact.update({
          where: { id: existing.id },
          data: { lastSeen: new Date() },
        });
        unchanged++;
      }
    } else {
      const saved = await prismaClient.artifact.create({
        data: {
          ...artifact,
          url: canonicalUrl,
          researchSpaceId: spaceId,
        },
      });
      await prismaClient.artifactVersion.create({
        data: {
          artifactId: saved.id,
          collectionId: collection.id,
          contentHash,
          metadata: JSON.stringify(snapshotPayload),
        },
      });
      created++;
    }
  }

  return {
    created,
    updated,
    unchanged,
    failed: failedRecords.length,
    normalized,
  };
}

/**
 * Runs change detection by comparing the current collection against the
 * previous successful collection for the same source. Generates signals
 * from any detected changes.
 *
 * @param {object} prismaClient
 * @param {object} collection - Current Collection DB record
 * @param {object} source - Source DB record
 * @returns {Promise<{eligible: boolean, summary: object, signalsCreated: number}>}
 */
async function detectChanges(prismaClient, collection, source) {
  const successfulCollections = await prismaClient.collection.findMany({
    where: { sourceId: source.id, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });

  // Need at least 2 successful collections for comparison
  const currentIdx = successfulCollections.findIndex((c) => c.id === collection.id);
  const previousCollection = currentIdx >= 0
    ? successfulCollections[currentIdx + 1]
    : successfulCollections[1];

  if (!previousCollection) {
    return { eligible: false, summary: { new: 0, updated: 0, removed: 0, unchanged: 0 }, signalsCreated: 0 };
  }

  const comparison = await compareCollections(previousCollection, collection, prismaClient);
  if (!comparison.eligible) {
    return { eligible: false, summary: comparison.summary || { new: 0, updated: 0, removed: 0, unchanged: 0 }, signalsCreated: 0 };
  }

  const signalResult = await generateSignalsFromComparison(comparison, prismaClient);

  return {
    eligible: true,
    comparison,
    summary: comparison.summary,
    signalsCreated: signalResult.created,
    signalsExisting: signalResult.existing,
  };
}

/**
 * Full pipeline: ingest → detect changes → return summary.
 * Called after a successful collection to process the entire downstream chain.
 *
 * @param {object} prismaClient
 * @param {string} collectionId - ID of the Collection record
 * @returns {Promise<object>} Pipeline execution result
 */
async function runPipeline(prismaClient, collectionId) {
  const collection = await prismaClient.collection.findUnique({
    where: { id: collectionId },
    include: { source: true },
  });

  if (!collection || collection.status !== "SUCCESS") {
    return { success: false, error: "Collection not found or not successful" };
  }

  const source = collection.source;
  const sourceName = source.name;

  // Step 1: Ingest (normalize + upsert + version)
  const ingestResult = await ingestCollection(prismaClient, collection, source, sourceName);

  // Step 2: Change detection
  const changeResult = await detectChanges(prismaClient, collection, source);

  // Step 3: Relationship matching (runs across ALL artifacts in the space,
  // not just the current collection — a new paper from arXiv might match
  // a GitHub repo that was ingested months ago)
  const matchResult = await matchRelationships(prismaClient, source.researchSpaceId);

  return {
    success: true,
    collectionId,
    sourceName,
    ingest: ingestResult,
    changes: changeResult,
    relationships: matchResult,
  };
}

/**
 * Computes aggregated change counts from recent signals for dashboard display.
 * @param {object} prismaClient
 * @param {string} researchSpaceId
 * @returns {Promise<object>} Change summary with real counts
 */
async function getChangeSummary(prismaClient, researchSpaceId) {
  if (!researchSpaceId) {
    return { new: 0, updated: 0, removed: 0, unchanged: 0, hasComparison: false, signalsCount: 0 };
  }

  const signals = await prismaClient.researchSignal.findMany({
    where: { researchSpaceId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const newCount = signals.filter((s) => s.type === "NEW").length;
  const updatedCount = signals.filter((s) => s.type === "UPDATED").length;
  const removedCount = signals.filter((s) => s.type === "REMOVED").length;

  return {
    new: newCount,
    updated: updatedCount,
    removed: removedCount,
    unchanged: 0, // Not tracked in signals, computed during comparison
    hasComparison: signals.length > 0,
    signalsCount: signals.length,
  };
}

module.exports = {
  runPipeline,
  ingestCollection,
  detectChanges,
  loadRawRecords,
  getChangeSummary,
};
