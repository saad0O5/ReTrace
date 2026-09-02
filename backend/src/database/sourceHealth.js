// Source health computation derived directly from database collection history.
// Answers: "Is this source configured correctly, and when was it last successfully collected?"
// Never assumes a source is healthy merely because a collector ID is configured.

/**
 * Derives health metrics for a single source row based on its collection history.
 * @param {object} source - Source model record from Prisma
 * @param {object[]} collections - Array of Collection records for this source, ordered newest first
 * @returns {object} Derived health summary
 */
function deriveSourceHealth(source, collections = []) {
  const isConfigured = Boolean(source.collectorId && source.collectorId !== "UNSET");
  const isFixture = source.name === "fixture";

  if (!collections || collections.length === 0) {
    return {
      id: source.id,
      name: source.name,
      collectorId: source.collectorId || null,
      baseUrl: source.baseUrl,
      artifactTypes: source.artifactTypes,
      status: isFixture ? "TEST SOURCE" : isConfigured ? "CONFIGURED" : "UNSET",
      configured: isConfigured,
      lastRun: source.lastRun || null,
      lastSuccessAt: source.lastSuccessAt || null,
      recordCount: 0,
      errorMessage: null,
      totalCollections: 0,
    };
  }

  const latest = collections[0];
  const lastSuccessful = collections.filter((c) => c.status === "SUCCESS" && (c.recordCount ?? 0) > 0).sort((a, b) => new Date(b.completedAt || b.startedAt) - new Date(a.completedAt || a.startedAt))[0];

  let status;
  let errorMessage = null;
  if (isFixture) {
    status = "TEST SOURCE";
  } else if (latest.status === "SUCCESS") {
    if ((latest.recordCount ?? 0) <= 0) {
      status = "DRIFTING";
      errorMessage = "Latest collection succeeded but returned zero records; source may have drifted or extraction may be stale.";
    } else {
      status = "HEALTHY";
    }
  } else if (latest.status === "FAILED") {
    status = "EXTRACTION_FAILED";
    errorMessage = latest.errorMessage || null;
  } else if (latest.status === "RUNNING" || latest.status === "PENDING") {
    status = latest.status;
  } else {
    status = isConfigured ? "CONFIGURED" : "UNSET";
  }

  return {
    id: source.id,
    name: source.name,
    collectorId: source.collectorId || null,
    baseUrl: source.baseUrl,
    artifactTypes: source.artifactTypes,
    status,
    configured: isConfigured,
    lastRun: latest.startedAt || source.lastRun || null,
    lastSuccessAt: lastSuccessful
      ? lastSuccessful.completedAt || lastSuccessful.startedAt
      : source.lastSuccessAt || null,
    recordCount: latest.recordCount ?? 0,
    errorMessage,
    totalCollections: collections.length,
  };
}

/**
 * Fetches sources with their derived health from the database.
 * @param {object} prismaClient
 * @param {string} [researchSpaceId]
 * @returns {Promise<object[]>} Array of sources with derived health
 */
async function getSourcesWithHealth(prismaClient, researchSpaceId) {
  const where = researchSpaceId ? { researchSpaceId } : {};
  const sources = await prismaClient.source.findMany({
    where,
    include: {
      collections: {
        orderBy: { startedAt: "desc" },
      },
    },
  });

  return sources.map((s) => deriveSourceHealth(s, s.collections));
}

module.exports = {
  deriveSourceHealth,
  getSourcesWithHealth,
};
