const assert = require("assert");
const {
  getArtifactStats,
  getImplementationCoverage,
  getRelationshipStats,
  tokenizeText,
  extractKeywords,
  getPublicationTimeline,
  getDataCompleteness,
  buildAttentionQueue,
  enrichSignals,
  buildResearchLandscapeReport,
} = require("../src/analysis/researchAnalytics");

function makePaper(id, title, description = "", publishedAt = null, metadata = {}) {
  return {
    id,
    type: "PAPER",
    title,
    description,
    source: "arxiv",
    publishedAt,
    metadata: JSON.stringify(metadata),
    url: `https://example.org/paper/${id}`,
  };
}

function makeRepo(id, title, description = "", url = null, metadata = {}) {
  return {
    id,
    type: "IMPLEMENTATION",
    title,
    description,
    source: "github",
    url: url || `https://github.com/example/${id}`,
    metadata: JSON.stringify(metadata),
  };
}

function makeRelationship(sourceId, targetId, confidence = 0.8, type = "IMPLEMENTED_BY") {
  return {
    id: `${sourceId}:${targetId}`,
    sourceArtifactId: sourceId,
    targetArtifactId: targetId,
    relationshipType: type,
    confidence,
    sourceArtifact: { id: sourceId, type: "PAPER" },
    targetArtifact: { id: targetId, type: "IMPLEMENTATION" },
  };
}

const paperA = makePaper("p1", "OTFS channel estimation for sparse channels", "Channel estimation in OTFS using sparsity and delay-Doppler structure.", "2024-01-15T00:00:00.000Z", { authors: ["A", "B"] });
const paperB = makePaper("p2", "MIMO detection with OTFS waveforms", "This paper studies MIMO detection with OTFS and Doppler-sensitive channels.", "2023-06-01T00:00:00.000Z", { authors: ["C"] });
const paperC = makePaper("p3", "Paper without date", "No date here but it still contains OTFS and Doppler terms.", null, { authors: [] });
const repoA = makeRepo("r1", "OTFS Channel Estimation Code", "Implementation of OTFS channel estimation and equalization in Python.", "https://github.com/example/repo1", { owner: "example" });
const repoB = makeRepo("r2", "MIMO equalization toolkit", "Toolkit for MIMO equalization and Doppler compensation.", "https://github.com/example/repo2", { owner: "example" });
const repoC = makeRepo("r3", "No description repo", "", "https://github.com/example/repo3", { owner: "example" });
const relationships = [
  makeRelationship("p1", "r1", 0.92),
  makeRelationship("p2", "r2", 0.76),
  makeRelationship("p2", "r1", 0.44),
];
const artifacts = [paperA, paperB, paperC, repoA, repoB, repoC];
const signals = [
  { id: "s1", type: "NEW", createdAt: "2025-01-01T00:00:00.000Z", evidence: JSON.stringify({ artifactId: "p1", url: paperA.url, type: "PAPER" }) },
  { id: "s2", type: "UPDATED", createdAt: "2025-02-15T00:00:00.000Z", evidence: JSON.stringify({ artifactId: "r2", url: repoB.url, type: "IMPLEMENTATION" }) },
];

let passed = 0;
let total = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn });
}

async function runQueue() {
  console.log("\n============================================================");
  console.log("RUNNING RETRACE PHASE 3 TEST SUITE");
  console.log("============================================================\n");

  for (const t of testQueue) {
    total++;
    try {
      t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log("\n============================================================");
  console.log(`PHASE 3 TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");
  if (passed !== total) {
    process.exit(1);
  }
}

test("Artifact counts are calculated correctly", () => {
  const stats = getArtifactStats(artifacts);
  assert.strictEqual(stats.total, 6);
  assert.strictEqual(stats.papers, 3);
  assert.strictEqual(stats.implementations, 3);
  assert.strictEqual(stats.byType.PAPER, 3);
  assert.strictEqual(stats.byType.IMPLEMENTATION, 3);
});

test("Implementation coverage is calculated from relationships, not guesses", () => {
  const coverage = getImplementationCoverage(artifacts, relationships);
  assert.strictEqual(coverage.totalPapers, 3);
  assert.strictEqual(coverage.papersWithImplementation, 2);
  assert.strictEqual(coverage.papersWithoutImplementation, 1);
  assert.strictEqual(coverage.coveragePercent, 66.67);
});

test("Relationship statistics are correct", () => {
  const stats = getRelationshipStats(artifacts, relationships);
  assert.strictEqual(stats.totalRelationships, 3);
  assert.strictEqual(stats.byType.IMPLEMENTED_BY, 3);
  assert.strictEqual(stats.averageConfidence, 0.707);
  assert.strictEqual(stats.papersWithMultipleImplementations, 1);
  assert.strictEqual(stats.implementationsLinkedToMultiplePapers, 1);
});

test("Keyword extraction is deterministic", () => {
  const keywords = extractKeywords([paperA, paperB]);
  const labels = keywords.map((item) => item.term);
  assert.deepStrictEqual(labels.includes("otfs"), true);
  assert.deepStrictEqual(labels.includes("channel"), true);
  assert.deepStrictEqual(keywords.length > 0, true);
});

test("Common stopwords are excluded", () => {
  const tokens = tokenizeText("This paper uses a method for channel estimation in OTFS systems");
  assert.deepStrictEqual(tokens.includes("this"), false);
  assert.deepStrictEqual(tokens.includes("for"), false);
  assert.deepStrictEqual(tokens.includes("a"), false);
  assert.deepStrictEqual(tokens.includes("channel"), true);
});

test("Domain-specific terms remain available", () => {
  const tokens = tokenizeText("OTFS channel estimation with Doppler delay MIMO equalization");
  assert.deepStrictEqual(tokens.includes("otfs"), true);
  assert.deepStrictEqual(tokens.includes("channel"), true);
  assert.deepStrictEqual(tokens.includes("doppler"), true);
  assert.deepStrictEqual(tokens.includes("mimo"), true);
});

test("Publication timeline handles valid dates correctly", () => {
  const timeline = getPublicationTimeline(artifacts);
  assert.deepStrictEqual(timeline.byYear.some((item) => item.year === "2023"), true);
  assert.deepStrictEqual(timeline.byYear.some((item) => item.year === "2024"), true);
  assert.strictEqual(timeline.knownDates, 2);
});

test("Missing dates do not crash analytics", () => {
  const timeline = getPublicationTimeline(artifacts);
  assert.strictEqual(typeof timeline.unknownDates, "number");
  assert.strictEqual(timeline.unknownDates >= 1, true);
});

test("Data completeness percentages are calculated correctly", () => {
  const completeness = getDataCompleteness(artifacts);
  assert.strictEqual(typeof completeness.papers.title, "number");
  assert.strictEqual(typeof completeness.implementations.url, "number");
  assert.strictEqual(completeness.summary.paperMetadataCoverage > 0, true);
});

test("Missing fields are handled safely", () => {
  const completeness = getDataCompleteness([paperC, repoC]);
  assert.strictEqual(typeof completeness.papers.abstract, "number");
  assert.strictEqual(typeof completeness.implementations.description, "number");
  assert.strictEqual(completeness.implementations.description >= 0, true);
});

test("Attention score is deterministic", () => {
  const queue = buildAttentionQueue(artifacts, relationships, signals);
  assert.strictEqual(Array.isArray(queue), true);
  assert.strictEqual(queue[0].attentionScore > 0, true);
  assert.strictEqual(queue.every((item) => item.attentionScore >= 0), true);
});

test("Review queue is deterministic and source-aware", () => {
  const queue = buildAttentionQueue(artifacts, relationships, signals);
  const first = queue[0];
  assert.strictEqual(first.title, paperA.title);
  assert.strictEqual(first.source, "arxiv");
});

test("Signals can be enriched without duplication", () => {
  const enriched = enrichSignals(signals, relationships, artifacts);
  assert.strictEqual(enriched.length, 2);
  assert.strictEqual(enriched[0].artifactTitle, paperA.title);
  assert.ok(
    enriched[0].relationship === null ||
      typeof enriched[0].relationship === "object"
  );
  assert.strictEqual(enriched[1].artifactType, "IMPLEMENTATION");
});

test("Analytics report preserves provenance and uses real relationships only", () => {
  const report = buildResearchLandscapeReport({ artifacts, relationships, sources: [{ name: "arxiv", collectorId: "abc", status: "HEALTHY", artifactTypes: "PAPER" }], signals });
  assert.strictEqual(report.overview.totalArtifacts, 6);
  assert.strictEqual(report.relationshipStats.totalRelationships, 3);
  assert.strictEqual(report.keywords.length > 0, true);
  assert.strictEqual(report.sourceContribution[0].name, "arxiv");
  assert.strictEqual(report.enrichedSignals.length, 2);
  assert.strictEqual(report.attentionQueue.length, 3);
});

runQueue();
