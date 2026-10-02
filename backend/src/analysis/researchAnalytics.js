const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "in", "on", "with", "to", "is", "are",
  "using", "based", "via", "from", "into", "this", "that", "these", "those", "paper", "papers",
  "code", "implementation", "implementations", "official", "repository", "repositories", "repo",
  "method", "methods", "approach", "approaches", "analysis", "study", "studies", "results",
  "proposed", "result", "system", "systems", "performance", "review", "using", "used"
]);

function safeNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getArtifactStats(artifacts = []) {
  const byType = {};
  const bySource = {};
  let papers = 0;
  let implementations = 0;
  let datasets = 0;
  let resources = 0;
  let projects = 0;

  for (const artifact of artifacts) {
    const type = artifact.type || "UNKNOWN";
    const source = artifact.source || "unknown";
    byType[type] = (byType[type] || 0) + 1;
    bySource[source] = (bySource[source] || 0) + 1;

    if (type === "PAPER") papers += 1;
    if (type === "IMPLEMENTATION") implementations += 1;
    if (type === "DATASET") datasets += 1;
    if (type === "RESOURCE") resources += 1;
    if (type === "PROJECT") projects += 1;
  }

  return {
    total: artifacts.length,
    papers,
    implementations,
    datasets,
    resources,
    projects,
    byType,
    bySource,
  };
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function getImplementationCoverage(artifacts = [], relationships = []) {
  const papers = artifacts.filter((a) => a.type === "PAPER");
  const paperIds = new Set(papers.map((a) => a.id));
  const linkedPaperIds = new Set(
    relationships
      .filter((r) => {
        const sourceType = r.sourceArtifact?.type || r.sourceArtifactType || "";
        const targetType = r.targetArtifact?.type || r.targetArtifactType || "";
        return sourceType === "PAPER" && targetType === "IMPLEMENTATION";
      })
      .map((r) => r.sourceArtifactId || r.sourceArtifact?.id)
      .filter(Boolean)
  );

  const linkedPapers = papers.filter((paper) => linkedPaperIds.has(paper.id));
  const papersWithoutImplementation = papers.filter((paper) => !linkedPaperIds.has(paper.id));
  const total = papers.length;
  const coverage = total > 0 ? (linkedPapers.length / total) * 100 : 0;

  return {
    totalPapers: total,
    papersWithImplementation: linkedPapers.length,
    papersWithoutImplementation: papersWithoutImplementation.length,
    coveragePercent: Number(coverage.toFixed(2)),
    linkedPaperIds: [...linkedPaperIds],
    papersWithoutImplementationIds: papersWithoutImplementation.map((paper) => paper.id),
  };
}

function getRelationshipStats(artifacts = [], relationships = []) {
  const byType = {};
  let totalConfidence = 0;
  const paperImplementationCounts = new Map();
  const implementationPaperCounts = new Map();

  for (const relationship of relationships) {
    const type = relationship.relationshipType || "UNKNOWN";
    byType[type] = (byType[type] || 0) + 1;
    totalConfidence += safeNumber(relationship.confidence, 0);

    const sourceId = relationship.sourceArtifactId || relationship.sourceArtifact?.id;
    const targetId = relationship.targetArtifactId || relationship.targetArtifact?.id;

    if (sourceId) {
      const current = paperImplementationCounts.get(sourceId) || 0;
      paperImplementationCounts.set(sourceId, current + 1);
    }
    if (targetId) {
      const current = implementationPaperCounts.get(targetId) || 0;
      implementationPaperCounts.set(targetId, current + 1);
    }
  }

  const paperCounts = [...paperImplementationCounts.values()];
  const implCounts = [...implementationPaperCounts.values()];
  const papers = artifacts.filter((a) => a.type === "PAPER");
  const implementations = artifacts.filter((a) => a.type === "IMPLEMENTATION");
  const paperIds = new Set(papers.map((a) => a.id));
  const implIds = new Set(implementations.map((a) => a.id));
  const linkedPaperIds = new Set(
    relationships
      .filter((r) => {
        const sourceType = r.sourceArtifact?.type || r.sourceArtifactType || "";
        const targetType = r.targetArtifact?.type || r.targetArtifactType || "";
        return sourceType === "PAPER" && targetType === "IMPLEMENTATION";
      })
      .map((r) => r.sourceArtifactId || r.sourceArtifact?.id)
      .filter(Boolean)
  );
  const linkedImplIds = new Set(
    relationships
      .filter((r) => {
        const sourceType = r.sourceArtifact?.type || r.sourceArtifactType || "";
        const targetType = r.targetArtifact?.type || r.targetArtifactType || "";
        return sourceType === "PAPER" && targetType === "IMPLEMENTATION";
      })
      .map((r) => r.targetArtifactId || r.targetArtifact?.id)
      .filter(Boolean)
  );

  const maxConfidence = relationships.length ? Math.max(...relationships.map((r) => safeNumber(r.confidence, 0))) : 0;
  const minConfidence = relationships.length ? Math.min(...relationships.map((r) => safeNumber(r.confidence, 0))) : 0;

  return {
    totalRelationships: relationships.length,
    byType,
    averageConfidence: relationships.length ? Number((totalConfidence / relationships.length).toFixed(3)) : 0,
    highestConfidence: Number(maxConfidence.toFixed(3)),
    lowestConfidence: Number(minConfidence.toFixed(3)),
    papersWithMultipleImplementations: paperCounts.filter((count) => count > 1).length,
    implementationsLinkedToMultiplePapers: implCounts.filter((count) => count > 1).length,
    unlinkedPapers: papers.filter((paper) => !linkedPaperIds.has(paper.id)).length,
    unlinkedImplementations: implementations.filter((repo) => !linkedImplIds.has(repo.id)).length,
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeText(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function extractKeywords(artifacts = [], options = {}) {
  const limit = options.limit || 20;
  const minCount = options.minCount || 1;
  const termMap = new Map();

  for (const artifact of artifacts) {
    const textParts = [artifact.title, artifact.description];
    const metadata = parseJson(artifact.metadata, {});
    if (Array.isArray(metadata.keywords)) {
      textParts.push(...metadata.keywords);
    }
    if (typeof metadata.keywords === "string") {
      textParts.push(metadata.keywords);
    }

    const tokens = [];
    for (const part of textParts) {
      tokens.push(...tokenizeText(part));
    }

    const seen = new Set();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);

      const entry = termMap.get(token) || { count: 0, artifactIds: new Set() };
      entry.count += 1;
      if (artifact.id) entry.artifactIds.add(artifact.id);
      termMap.set(token, entry);
    }
  }

  return [...termMap.entries()]
    .filter(([, entry]) => entry.count >= minCount)
    .map(([term, entry]) => ({
      term,
      count: entry.count,
      artifactIds: [...entry.artifactIds],
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

function getPublicationTimeline(artifacts = []) {
  const paperArtifacts = artifacts.filter((a) => a.type === "PAPER");
  const timeline = {};
  const monthly = {};
  let knownDates = 0;
  let unknownDates = 0;
  let newest = null;
  let oldest = null;

  for (const artifact of paperArtifacts) {
    const rawDate = artifact.publishedAt || parseJson(artifact.metadata, {}).publishedDate || null;
    const parsed = rawDate ? new Date(rawDate) : null;

    if (parsed && !Number.isNaN(parsed.getTime())) {
      knownDates += 1;
      const year = String(parsed.getFullYear());
      timeline[year] = (timeline[year] || 0) + 1;

      const monthKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
      monthly[monthKey] = (monthly[monthKey] || 0) + 1;

      if (!newest || parsed > newest) newest = parsed;
      if (!oldest || parsed < oldest) oldest = parsed;
    } else {
      unknownDates += 1;
    }
  }

  const sortedYears = Object.entries(timeline).sort(([a], [b]) => Number(a) - Number(b));
  const sortedMonths = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));

  return {
    byYear: sortedYears.map(([year, count]) => ({ year, count })),
    byMonth: sortedMonths.map(([month, count]) => ({ month, count })),
    knownDates,
    unknownDates,
    newestPaper: newest ? newest.toISOString() : null,
    oldestPaper: oldest ? oldest.toISOString() : null,
    papersWithoutPublicationDate: unknownDates,
  };
}

function getRecentResearchActivity(artifacts = [], signals = [], days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const paperPubs = artifacts.filter((a) => a.type === "PAPER" && a.publishedAt && new Date(a.publishedAt).getTime() >= cutoff).length;
  const implPubs = artifacts.filter((a) => a.type === "IMPLEMENTATION" && a.publishedAt && new Date(a.publishedAt).getTime() >= cutoff).length;
  const signalCount = signals.filter((s) => s.createdAt && new Date(s.createdAt).getTime() >= cutoff).length;

  return {
    windowDays: days,
    papers: paperPubs,
    implementations: implPubs,
    signals: signalCount,
  };
}

function getDataCompleteness(artifacts = []) {
  const paperArtifacts = artifacts.filter((a) => a.type === "PAPER");
  const implArtifacts = artifacts.filter((a) => a.type === "IMPLEMENTATION");

  const scoreField = (items, field) => {
    if (!items.length) return 0;
    let found = 0;
    for (const item of items) {
      const value = item[field];
      const metadata = parseJson(item.metadata, {});
      if (field === "title") {
        if (item.title && item.title.trim()) found += 1;
      } else if (field === "abstract") {
        if (item.description && item.description.trim()) found += 1;
      } else if (field === "authors") {
        const authors = metadata.authors || [];
        if (Array.isArray(authors) && authors.length > 0) found += 1;
      } else if (field === "publicationDate") {
        if (item.publishedAt) found += 1;
      } else if (field === "url") {
        if (item.url && item.url.trim()) found += 1;
      } else if (field === "owner") {
        const owner = metadata.owner || (item.url ? new URL(item.url).pathname.split("/")[1] : null);
        if (owner) found += 1;
      } else if (field === "description") {
        if (item.description && item.description.trim()) found += 1;
      }
    }
    return Number(((found / items.length) * 100).toFixed(2));
  };

  const paperCoverage = {
    title: scoreField(paperArtifacts, "title"),
    abstract: scoreField(paperArtifacts, "abstract"),
    authors: scoreField(paperArtifacts, "authors"),
    publicationDate: scoreField(paperArtifacts, "publicationDate"),
    url: scoreField(paperArtifacts, "url"),
  };

  const implCoverage = {
    title: scoreField(implArtifacts, "title"),
    description: scoreField(implArtifacts, "description"),
    url: scoreField(implArtifacts, "url"),
    owner: scoreField(implArtifacts, "owner"),
  };

  return {
    papers: paperCoverage,
    implementations: implCoverage,
    summary: {
      paperMetadataCoverage: Number((Object.values(paperCoverage).reduce((sum, value) => sum + value, 0) / Math.max(Object.keys(paperCoverage).length, 1)).toFixed(2)),
      implementationMetadataCoverage: Number((Object.values(implCoverage).reduce((sum, value) => sum + value, 0) / Math.max(Object.keys(implCoverage).length, 1)).toFixed(2)),
    },
  };
}

function getResearchGaps(artifacts = [], relationships = []) {
  const papers = artifacts.filter((a) => a.type === "PAPER");
  const implementations = artifacts.filter((a) => a.type === "IMPLEMENTATION");
  const linkedPaperIds = new Set(
    relationships
      .filter((r) => r.relationshipType === "IMPLEMENTED_BY")
      .map((r) => r.sourceArtifactId || r.sourceArtifact?.id)
      .filter(Boolean)
  );
  const linkedImplementationIds = new Set(
    relationships
      .filter((r) => r.relationshipType === "IMPLEMENTED_BY")
      .map((r) => r.targetArtifactId || r.targetArtifact?.id)
      .filter(Boolean)
  );

  const evidenceGaps = [
    {
      type: "implementationCoverage",
      label: "Papers without linked implementation",
      value: papers.filter((paper) => !linkedPaperIds.has(paper.id)).length,
      description: "Papers observed in this research space without a linked implementation record detected by the relationship layer.",
    },
    {
      type: "publicationDates",
      label: "Papers without publication date",
      value: papers.filter((paper) => !paper.publishedAt).length,
      description: "Observed papers without a parsed publication date in the normalized record metadata.",
    },
    {
      type: "abstractCoverage",
      label: "Papers without abstract/description",
      value: papers.filter((paper) => !paper.description || !paper.description.trim()).length,
      description: "Papers with missing abstract or description text that reduces the signal available for keyword extraction.",
    },
    {
      type: "implementationDescription",
      label: "Implementations without description",
      value: implementations.filter((repo) => !repo.description || !repo.description.trim()).length,
      description: "Repository records without descriptive text available for evidence-based matching.",
    },
    {
      type: "implementationCoverage",
      label: "Implementations without detected paper link",
      value: implementations.filter((repo) => !linkedImplementationIds.has(repo.id)).length,
      description: "Implementation artifacts that have not yet been connected to a paper in the current relationship layer.",
    },
  ].filter((gap) => gap.value > 0);

  return {
    gaps: evidenceGaps,
    totalGaps: evidenceGaps.length,
  };
}

function buildAttentionQueue(artifacts = [], relationships = [], signals = []) {
  const paperArtifacts = artifacts.filter((a) => a.type === "PAPER");
  const scored = paperArtifacts.map((paper) => {
    const relationshipMatches = relationships.filter((r) => (r.sourceArtifactId || r.sourceArtifact?.id) === paper.id);
    const paperSignals = signals.filter((s) => {
      const evidence = parseJson(s.evidence, {});
      return evidence.url === paper.url || evidence.artifactId === paper.id;
    });

    const latestDate = paper.publishedAt ? new Date(paper.publishedAt) : null;
    const recencyScore = latestDate && !Number.isNaN(latestDate.getTime()) ? 1 : 0;
    const implementationScore = relationshipMatches.length > 0 ? 1 : 0;
    const relationshipConfidence = relationshipMatches.length
      ? Math.max(...relationshipMatches.map((r) => safeNumber(r.confidence, 0)))
      : 0;
    const changeScore = paperSignals.some((signal) => signal.type !== "REMOVED") ? 1 : 0;
    const metadataScore = [paper.title, paper.description, paper.url].filter(Boolean).length / 3;

    const attentionScore = Number(
      (recencyScore * 0.35 + implementationScore * 0.25 + changeScore * 0.20 + (relationshipConfidence || 0) * 0.20 + metadataScore * 0.10).toFixed(3)
    );

    return {
      artifactId: paper.id,
      title: paper.title,
      url: paper.url,
      source: paper.source,
      publishedAt: paper.publishedAt,
      implementationStatus: relationshipMatches.length > 0 ? "Linked" : "No linked implementation detected",
      relationshipConfidence: Number(Math.max(0, Math.min(1, relationshipConfidence || 0)).toFixed(3)),
      recentChange: paperSignals.length ? paperSignals[0].type : "NONE",
      attentionScore,
      reason: [
        relationshipMatches.length > 0 ? "linked implementation" : "unlinked implementation status",
        latestDate ? "recent publication evidence" : "publication date unavailable",
        paperSignals.length ? `recent ${paperSignals[0].type.toLowerCase()} signal` : "no recent change signal",
      ].join("; "),
    };
  });

  return scored.sort((a, b) => b.attentionScore - a.attentionScore || a.title.localeCompare(b.title));
}

function enrichSignals(signals = [], relationships = [], artifacts = []) {
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return signals.map((signal) => {
    const evidence = parseJson(signal.evidence, {});
    const artifactId = evidence.artifactId || signal.artifactId || null;
    const artifact = artifactId ? artifactMap.get(artifactId) : null;

    let relationship = null;
    if (artifact) {
      relationship = relationships.find((r) => {
        const sourceId = r.sourceArtifactId || r.sourceArtifact?.id;
        const targetId = r.targetArtifactId || r.targetArtifact?.id;
        return sourceId === artifact.id || targetId === artifact.id;
      }) || null;
    }

    return {
      ...signal,
      artifactTitle: artifact?.title || evidence.title || null,
      artifactType: evidence.type || artifact?.type || null,
      relationship,
      evidence,
    };
  });
}

function buildResearchLandscapeReport({ artifacts = [], relationships = [], sources = [], signals = [] } = {}) {
  const artifactStats = getArtifactStats(artifacts);
  const implementationCoverage = getImplementationCoverage(artifacts, relationships);
  const relationshipStats = getRelationshipStats(artifacts, relationships);
  const keywords = extractKeywords(artifacts.filter((a) => a.type === "PAPER"));
  const timeline = getPublicationTimeline(artifacts);
  const activity = {
    last30Days: getRecentResearchActivity(artifacts, signals, 30),
    last90Days: getRecentResearchActivity(artifacts, signals, 90),
    last180Days: getRecentResearchActivity(artifacts, signals, 180),
    last365Days: getRecentResearchActivity(artifacts, signals, 365),
  };
  const completeness = getDataCompleteness(artifacts);
  const gaps = getResearchGaps(artifacts, relationships);
  const attentionQueue = buildAttentionQueue(artifacts, relationships, signals);
  const enrichedSignals = enrichSignals(signals, relationships, artifacts);

  const sourceContribution = (sources || []).map((source) => ({
    name: source.name,
    collectorId: source.collectorId,
    status: source.status,
    artifactCount: artifactStats.bySource[source.name] || 0,
    artifactTypes: source.artifactTypes ? source.artifactTypes.split(",") : [],
    lastRun: source.lastRun || null,
    lastSuccessAt: source.lastSuccessAt || null,
  }));

  return {
    overview: {
      totalArtifacts: artifactStats.total,
      paperCount: artifactStats.papers,
      implementationCount: artifactStats.implementations,
      totalRelationships: relationshipStats.totalRelationships,
      totalSignals: signals.length,
      totalSources: sources.length,
    },
    artifactStats,
    implementationCoverage,
    relationshipStats,
    keywords,
    publicationTimeline: timeline,
    sourceContribution,
    recentResearchActivity: activity,
    dataCompleteness: completeness,
    researchGaps: gaps,
    attentionQueue,
    enrichedSignals,
  };
}

module.exports = {
  STOPWORDS,
  safeNumber,
  parseJson,
  getArtifactStats,
  getImplementationCoverage,
  getRelationshipStats,
  tokenizeText,
  extractKeywords,
  getPublicationTimeline,
  getRecentResearchActivity,
  getDataCompleteness,
  getResearchGaps,
  buildAttentionQueue,
  enrichSignals,
  buildResearchLandscapeReport,
};
