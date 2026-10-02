const fs = require("fs");
const path = require("path");
const { normalizeUrl } = require("../ingestion/urlNormalizer");
const { buildSnapshotPayload, computeContentHash } = require("../ingestion/snapshot");
const { normalizeArxivRecord, normalizeGithubRecord, normalizeCalderbankRecord } = require("../ingestion/normalizer");

const NORMALIZERS = {
  arxiv: normalizeArxivRecord,
  github: normalizeGithubRecord,
  "duke-calderbank": normalizeCalderbankRecord,
};

/**
 * Identifies field-level differences between previous and current snapshot payloads.
 * @param {object} prev - Previous snapshot payload
 * @param {object} curr - Current snapshot payload
 * @returns {string[]} Array of human-readable diff descriptions
 */
function diffSnapshotPayloads(prev, curr) {
  const changes = [];
  if (!prev || !curr) return ["Content replaced"];

  if (prev.title !== curr.title) {
    changes.push(`Title changed from "${prev.title}" to "${curr.title}"`);
  }

  if (prev.description !== curr.description) {
    if (!prev.description && curr.description) {
      changes.push("Abstract/description added");
    } else if (prev.description && !curr.description) {
      changes.push("Abstract/description removed");
    } else {
      changes.push("Abstract/description updated");
    }
  }

  if (Array.isArray(prev.authors) && Array.isArray(curr.authors)) {
    const prevAuthors = prev.authors.join(", ");
    const currAuthors = curr.authors.join(", ");
    if (prevAuthors !== currAuthors) {
      changes.push(`Authors changed: [${currAuthors}] (previously [${prevAuthors}])`);
    }
  }

  if (prev.publishedAt !== curr.publishedAt) {
    changes.push(`Published date changed to ${curr.publishedAt || "null"}`);
  }

  if (prev.venue !== curr.venue) {
    changes.push(`Venue changed to ${curr.venue || "null"}`);
  }

  if (prev.doi !== curr.doi) {
    changes.push(`DOI changed to ${curr.doi || "null"}`);
  }

  if (prev.stars !== curr.stars && typeof curr.stars === "number") {
    changes.push(`Stars updated: ${curr.stars} (previously ${prev.stars || 0})`);
  }

  if (prev.owner !== curr.owner && curr.owner) {
    changes.push(`Repository owner changed to ${curr.owner}`);
  }

  if (changes.length === 0) {
    changes.push("Metadata fields updated");
  }

  return changes;
}

/**
 * Pure comparison function between two sets of normalized artifact observations.
 * @param {object[]} previousList - Array of artifact objects from previous observation
 * @param {object[]} currentList - Array of artifact objects from current observation
 * @param {object} [context={}] - Metadata about the comparison (sourceName, collectionIds, timestamps)
 * @returns {object} Structured change detection result
 */
function compareArtifactSets(previousList = [], currentList = [], context = {}) {
  const previousMap = new Map();
  const currentMap = new Map();

  // Index previous artifacts
  for (const item of previousList) {
    const canonicalUrl = normalizeUrl(item.url) || item.url;
    if (!canonicalUrl) continue;
    const payload = buildSnapshotPayload(item);
    const contentHash = item.contentHash || computeContentHash(payload);
    previousMap.set(canonicalUrl, {
      raw: item,
      url: canonicalUrl,
      title: item.title || payload.title,
      type: item.type || payload.type,
      payload,
      contentHash,
    });
  }

  // Index current artifacts
  for (const item of currentList) {
    const canonicalUrl = normalizeUrl(item.url) || item.url;
    if (!canonicalUrl) continue;
    const payload = buildSnapshotPayload(item);
    const contentHash = item.contentHash || computeContentHash(payload);
    currentMap.set(canonicalUrl, {
      raw: item,
      url: canonicalUrl,
      title: item.title || payload.title,
      type: item.type || payload.type,
      payload,
      contentHash,
    });
  }

  const newArtifacts = [];
  const updatedArtifacts = [];
  const removedArtifacts = [];
  const unchangedArtifacts = [];

  // Check current against previous
  for (const [url, currentItem] of currentMap.entries()) {
    if (!previousMap.has(url)) {
      newArtifacts.push({
        url,
        title: currentItem.title,
        type: currentItem.type,
        artifact: currentItem.raw,
        payload: currentItem.payload,
        contentHash: currentItem.contentHash,
      });
    } else {
      const prevItem = previousMap.get(url);
      if (prevItem.contentHash === currentItem.contentHash) {
        unchangedArtifacts.push({
          url,
          title: currentItem.title,
          type: currentItem.type,
          contentHash: currentItem.contentHash,
        });
      } else {
        const changes = diffSnapshotPayloads(prevItem.payload, currentItem.payload);
        updatedArtifacts.push({
          url,
          title: currentItem.title,
          type: currentItem.type,
          artifact: currentItem.raw,
          previousHash: prevItem.contentHash,
          currentHash: currentItem.contentHash,
          previousPayload: prevItem.payload,
          currentPayload: currentItem.payload,
          changes,
        });
      }
    }
  }

  // Check previous items absent from current
  for (const [url, prevItem] of previousMap.entries()) {
    if (!currentMap.has(url)) {
      removedArtifacts.push({
        url,
        title: prevItem.title,
        type: prevItem.type,
        artifact: prevItem.raw,
        payload: prevItem.payload,
        contentHash: prevItem.contentHash,
        reason: "Not observed in latest scan",
      });
    }
  }

  return {
    eligible: true,
    sourceId: context.sourceId || null,
    sourceName: context.sourceName || "unknown",
    previousCollectionId: context.previousCollectionId || null,
    currentCollectionId: context.currentCollectionId || null,
    previousTimestamp: context.previousTimestamp || null,
    currentTimestamp: context.currentTimestamp || null,
    newArtifacts,
    updatedArtifacts,
    removedArtifacts,
    unchangedArtifacts,
    summary: {
      new: newArtifacts.length,
      updated: updatedArtifacts.length,
      removed: removedArtifacts.length,
      unchanged: unchangedArtifacts.length,
      totalCurrent: currentMap.size,
      totalPrevious: previousMap.size,
    },
  };
}

/**
 * Loads artifact observations from a Collection model record.
 * Uses rawFilePath if accessible, otherwise falls back to linked ArtifactVersions or database artifacts.
 * @param {object} collection - Collection record from Prisma
 * @param {object} prismaClient
 * @param {string} sourceName
 * @returns {Promise<object[]>} Array of normalized artifact observation objects
 */
async function loadCollectionObservations(collection, prismaClient, sourceName) {
  // 1. Try reading raw JSON file if path exists on disk
  if (collection.rawFilePath) {
    try {
      const resolvedPath = path.isAbsolute(collection.rawFilePath)
        ? collection.rawFilePath
        : path.join(__dirname, "..", "..", "..", collection.rawFilePath);

      if (fs.existsSync(resolvedPath)) {
        const rawContent = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
        const records = Array.isArray(rawContent)
          ? rawContent
          : Array.isArray(rawContent.records)
          ? rawContent.records
          : [];

        const normalizer = NORMALIZERS[sourceName];
        if (normalizer && records.length > 0) {
          return records
            .map((r) => {
              try {
                return normalizer(r);
              } catch (_) {
                return null;
              }
            })
            .filter(Boolean);
        }
      }
    } catch (_) {
      // Fall through to database queries if file reading fails
    }
  }

  // 2. Query ArtifactVersion records linked to this collection
  const versions = await prismaClient.artifactVersion.findMany({
    where: { collectionId: collection.id },
    include: { artifact: true },
  });

  if (versions.length > 0) {
    return versions.map((v) => {
      let meta = {};
      try {
        meta = JSON.parse(v.metadata || "{}");
      } catch (_) {}

      return {
        id: v.artifact.id,
        type: v.artifact.type,
        title: v.artifact.title,
        description: v.artifact.description,
        url: v.artifact.url,
        publishedAt: v.artifact.publishedAt,
        metadata: v.metadata,
        contentHash: v.contentHash,
        authors: meta.authors || [],
      };
    });
  }

  return [];
}

/**
 * Compares two database Collection records for the same source.
 * Enforces strict safety rules (source isolation, status checks).
 * @param {object} previousCollection - Previous successful collection record
 * @param {object} currentCollection - Current successful collection record
 * @param {object} prismaClient - Prisma client instance
 * @param {object} [options={}] - Optional in-memory overrides for testing
 * @returns {Promise<object>} Structured comparison result
 */
async function compareCollections(previousCollection, currentCollection, prismaClient, options = {}) {
  if (!previousCollection || !currentCollection) {
    return {
      eligible: false,
      error: "Both previous and current collections must be provided for comparison.",
      summary: { new: 0, updated: 0, removed: 0, unchanged: 0, totalCurrent: 0, totalPrevious: 0 },
    };
  }

  // Source isolation check
  if (previousCollection.sourceId !== currentCollection.sourceId) {
    return {
      eligible: false,
      error: `Cannot compare collections from different sources (${previousCollection.sourceId} vs ${currentCollection.sourceId}).`,
      summary: { new: 0, updated: 0, removed: 0, unchanged: 0, totalCurrent: 0, totalPrevious: 0 },
    };
  }

  // Health and safety check: failed collections must not generate deltas
  if (currentCollection.status === "FAILED") {
    return {
      eligible: false,
      error: `Current collection (${currentCollection.id}) failed: ${currentCollection.errorMessage || "Unknown error"}. Preserving previous baseline without delta detection.`,
      summary: { new: 0, updated: 0, removed: 0, unchanged: 0, totalCurrent: 0, totalPrevious: 0 },
    };
  }

  if (previousCollection.status === "FAILED") {
    return {
      eligible: false,
      error: `Previous collection (${previousCollection.id}) failed and cannot serve as baseline.`,
      summary: { new: 0, updated: 0, removed: 0, unchanged: 0, totalCurrent: 0, totalPrevious: 0 },
    };
  }

  // Fetch source details
  const source = await prismaClient.source.findUnique({
    where: { id: currentCollection.sourceId },
  });
  const sourceName = source ? source.name : "unknown";

  // Load observations
  const previousList =
    options.previousArtifacts ||
    (await loadCollectionObservations(previousCollection, prismaClient, sourceName));

  const currentList =
    options.currentArtifacts ||
    (await loadCollectionObservations(currentCollection, prismaClient, sourceName));

  const context = {
    sourceId: source?.id || currentCollection.sourceId,
    sourceName,
    previousCollectionId: previousCollection.id,
    currentCollectionId: currentCollection.id,
    previousTimestamp: previousCollection.completedAt || previousCollection.startedAt,
    currentTimestamp: currentCollection.completedAt || currentCollection.startedAt,
  };

  return compareArtifactSets(previousList, currentList, context);
}

module.exports = {
  compareCollections,
  compareArtifactSets,
  diffSnapshotPayloads,
  loadCollectionObservations,
};
