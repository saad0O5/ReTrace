const { PrismaClient } = require("@prisma/client");

function parseEvidence(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

/**
 * Persists ResearchSignals generated from a collection comparison.
 * Strictly idempotent: re-running comparison between the same collections will not duplicate signals.
 *
 * @param {object} comparison - Result object from compareCollections
 * @param {object} prismaClient - PrismaClient instance
 * @returns {Promise<{ created: number, existing: number, signals: object[] }>}
 */
async function generateSignalsFromComparison(comparison, prismaClient) {
  if (!comparison || !comparison.eligible) {
    return { created: 0, existing: 0, signals: [] };
  }

  // Find research space
  const source = await prismaClient.source.findUnique({
    where: { id: comparison.sourceId },
  });
  const spaceId = source?.researchSpaceId;
  if (!spaceId) {
    return { created: 0, existing: 0, signals: [] };
  }

  // Fetch existing signals for this research space to enforce idempotency
  const existingSignals = await prismaClient.researchSignal.findMany({
    where: { researchSpaceId: spaceId },
  });

  const createdSignals = [];
  let existingCount = 0;

  // 1. Process NEW Artifacts
  for (const item of comparison.newArtifacts) {
    const isDuplicate = existingSignals.some((s) => {
      if (s.type !== "NEW") return false;
      const ev = parseEvidence(s.evidence);
      return ev.currentCollectionId === comparison.currentCollectionId && ev.url === item.url;
    });

    if (isDuplicate) {
      existingCount++;
      continue;
    }

    // Look up artifact in DB for relation links
    const artifact = await prismaClient.artifact.findFirst({
      where: { researchSpaceId: spaceId, url: item.url },
      include: {
        relationshipsFrom: { include: { targetArtifact: true } },
        relationshipsTo: { include: { sourceArtifact: true } },
      },
    });

    let relationshipInfo = null;
    let title = `New ${item.type === "IMPLEMENTATION" ? "Implementation" : "Paper"}: ${item.title}`;
    let description = `New ${item.type.toLowerCase()} observed on ${comparison.sourceName}.`;
    let severity = "info";

    if (item.type === "IMPLEMENTATION" && artifact?.relationshipsTo?.length > 0) {
      const rel = artifact.relationshipsTo[0];
      relationshipInfo = {
        paperTitle: rel.sourceArtifact.title,
        paperUrl: rel.sourceArtifact.url,
        confidence: rel.confidence,
      };
      description = `New repository discovered. Linked to paper "${rel.sourceArtifact.title}" (${(rel.confidence * 100).toFixed(1)}% confidence).`;
      severity = "medium";
    } else if (item.type === "PAPER" && artifact?.relationshipsFrom?.length > 0) {
      const rel = artifact.relationshipsFrom[0];
      relationshipInfo = {
        repoTitle: rel.targetArtifact.title,
        repoUrl: rel.targetArtifact.url,
        confidence: rel.confidence,
      };
      description = `New research paper observed. Implemented by repository "${rel.targetArtifact.title}".`;
    }

    const evidenceData = {
      artifactId: artifact?.id || null,
      url: item.url,
      type: item.type,
      sourceId: comparison.sourceId,
      sourceName: comparison.sourceName,
      currentCollectionId: comparison.currentCollectionId,
      previousCollectionId: comparison.previousCollectionId,
      contentHash: item.contentHash,
      observedAt: comparison.currentTimestamp || new Date().toISOString(),
      relationship: relationshipInfo,
    };

    const saved = await prismaClient.researchSignal.create({
      data: {
        researchSpaceId: spaceId,
        type: "NEW",
        title,
        description,
        severity,
        evidence: JSON.stringify(evidenceData),
      },
    });

    createdSignals.push(saved);
  }

  // 2. Process UPDATED Artifacts
  for (const item of comparison.updatedArtifacts) {
    const isDuplicate = existingSignals.some((s) => {
      if (s.type !== "UPDATED") return false;
      const ev = parseEvidence(s.evidence);
      return ev.currentCollectionId === comparison.currentCollectionId && ev.url === item.url;
    });

    if (isDuplicate) {
      existingCount++;
      continue;
    }

    const artifact = await prismaClient.artifact.findFirst({
      where: { researchSpaceId: spaceId, url: item.url },
    });

    const diffText = Array.isArray(item.changes) ? item.changes.join("; ") : "Metadata updated";
    const title = `Updated ${item.type === "IMPLEMENTATION" ? "Implementation" : "Paper"}: ${item.title}`;
    const description = `Observation changed on ${comparison.sourceName}: ${diffText}`;

    const evidenceData = {
      artifactId: artifact?.id || null,
      url: item.url,
      type: item.type,
      sourceId: comparison.sourceId,
      sourceName: comparison.sourceName,
      currentCollectionId: comparison.currentCollectionId,
      previousCollectionId: comparison.previousCollectionId,
      previousHash: item.previousHash,
      currentHash: item.currentHash,
      changes: item.changes || [],
      observedAt: comparison.currentTimestamp || new Date().toISOString(),
    };

    const saved = await prismaClient.researchSignal.create({
      data: {
        researchSpaceId: spaceId,
        type: "UPDATED",
        title,
        description,
        severity: "medium",
        evidence: JSON.stringify(evidenceData),
      },
    });

    createdSignals.push(saved);
  }

  // 3. Process REMOVED / ABSENT Artifacts
  for (const item of comparison.removedArtifacts) {
    const isDuplicate = existingSignals.some((s) => {
      if (s.type !== "REMOVED") return false;
      const ev = parseEvidence(s.evidence);
      return ev.currentCollectionId === comparison.currentCollectionId && ev.url === item.url;
    });

    if (isDuplicate) {
      existingCount++;
      continue;
    }

    const artifact = await prismaClient.artifact.findFirst({
      where: { researchSpaceId: spaceId, url: item.url },
    });

    const title = `Absent from Scan: ${item.title}`;
    const description = `Artifact not observed in latest ${comparison.sourceName} collection (previously seen in collection).`;

    const evidenceData = {
      artifactId: artifact?.id || null,
      url: item.url,
      type: item.type,
      sourceId: comparison.sourceId,
      sourceName: comparison.sourceName,
      currentCollectionId: comparison.currentCollectionId,
      previousCollectionId: comparison.previousCollectionId,
      lastObservedHash: item.contentHash,
      lastObservedAt: comparison.previousTimestamp,
      reason: "Not observed in latest scan",
    };

    const saved = await prismaClient.researchSignal.create({
      data: {
        researchSpaceId: spaceId,
        type: "REMOVED",
        title,
        description,
        severity: "low",
        evidence: JSON.stringify(evidenceData),
      },
    });

    createdSignals.push(saved);
  }

  return {
    created: createdSignals.length,
    existing: existingCount,
    signals: createdSignals,
  };
}

/**
 * Retrieves formatted ResearchSignals for dashboard export.
 * @param {string} [researchSpaceId]
 * @param {object} prismaClient
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
async function getLatestSignals(researchSpaceId, prismaClient, limit = 50) {
  const where = researchSpaceId ? { researchSpaceId } : {};
  const signals = await prismaClient.researchSignal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return signals.map((s) => {
    const ev = parseEvidence(s.evidence);
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
      relationship: ev.relationship || null,
      changes: ev.changes || [],
      evidence: ev,
    };
  });
}

module.exports = {
  generateSignalsFromComparison,
  getLatestSignals,
  parseEvidence,
};
