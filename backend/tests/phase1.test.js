const assert = require("assert");
const { PrismaClient } = require("@prisma/client");
const { compareArtifactSets, compareCollections, diffSnapshotPayloads } = require("../src/analysis/changeDetector");
const { generateSignalsFromComparison, getLatestSignals, parseEvidence } = require("../src/analysis/signalService");
const { buildSnapshotPayload, computeContentHash } = require("../src/ingestion/snapshot");
const { normalizeUrl } = require("../src/ingestion/urlNormalizer");

const prisma = new PrismaClient();

let passed = 0;
let total = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn, isAsync: false });
}

function asyncTest(name, fn) {
  testQueue.push({ name, fn, isAsync: true });
}

// ============================================================
// TEST 1 — All Unchanged
// ============================================================
test("TEST 1: All unchanged observations produce 0 new, 0 updated, 0 removed", () => {
  const prev = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER", description: "Desc A" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER", description: "Desc B" },
    { url: "https://arxiv.org/abs/2001.00003", title: "Paper C", type: "PAPER", description: "Desc C" },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER", description: "Desc A" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER", description: "Desc B" },
    { url: "https://arxiv.org/abs/2001.00003", title: "Paper C", type: "PAPER", description: "Desc C" },
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "arxiv" });
  assert.strictEqual(result.summary.new, 0, "Should have 0 new artifacts");
  assert.strictEqual(result.summary.updated, 0, "Should have 0 updated artifacts");
  assert.strictEqual(result.summary.removed, 0, "Should have 0 removed artifacts");
  assert.strictEqual(result.summary.unchanged, 3, "Should have 3 unchanged artifacts");
});

// ============================================================
// TEST 2 — One New Artifact
// ============================================================
test("TEST 2: New artifact detected correctly", () => {
  const prev = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER" },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00003", title: "Paper C", type: "PAPER" },
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "arxiv" });
  assert.strictEqual(result.summary.new, 1);
  assert.strictEqual(result.newArtifacts[0].url, "https://arxiv.org/abs/2001.00003");
  assert.strictEqual(result.newArtifacts[0].title, "Paper C");
  assert.strictEqual(result.summary.unchanged, 2);
});

// ============================================================
// TEST 3 — One Removed / Absent Artifact
// ============================================================
test("TEST 3: Absent artifact detected as removed/not observed in latest scan", () => {
  const prev = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00003", title: "Paper C", type: "PAPER" },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A", type: "PAPER" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER" },
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "arxiv" });
  assert.strictEqual(result.summary.removed, 1);
  assert.strictEqual(result.removedArtifacts[0].url, "https://arxiv.org/abs/2001.00003");
  assert.strictEqual(result.removedArtifacts[0].reason, "Not observed in latest scan");
  assert.strictEqual(result.summary.unchanged, 2);
});

// ============================================================
// TEST 4 — One Updated Artifact
// ============================================================
test("TEST 4: Content modifications detected as UPDATED with field-level diffs", () => {
  const prev = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A Original", type: "PAPER", description: "Old abstract" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER", description: "Desc B" },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2001.00001", title: "Paper A Revised", type: "PAPER", description: "New expanded abstract" },
    { url: "https://arxiv.org/abs/2001.00002", title: "Paper B", type: "PAPER", description: "Desc B" },
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "arxiv" });
  assert.strictEqual(result.summary.updated, 1);
  assert.strictEqual(result.summary.unchanged, 1);
  const updatedItem = result.updatedArtifacts[0];
  assert.strictEqual(updatedItem.url, "https://arxiv.org/abs/2001.00001");
  assert(updatedItem.changes.some((c) => c.includes("Title changed")), "Should identify title change");
  assert(updatedItem.changes.some((c) => c.includes("Abstract/description updated")), "Should identify description change");
});

// ============================================================
// TEST 5 — Mixed Changes (NEW + UPDATED + REMOVED + UNCHANGED)
// ============================================================
test("TEST 5: Mixed change batch produces accurate multi-category summary", () => {
  const prev = [
    { url: "https://github.com/org/repo-a", title: "repo-a", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 10 }) },
    { url: "https://github.com/org/repo-b", title: "repo-b", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 5 }) },
    { url: "https://github.com/org/repo-c", title: "repo-c", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 20 }) },
  ];
  const curr = [
    { url: "https://github.com/org/repo-a", title: "repo-a", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 55 }) }, // UPDATED (stars)
    { url: "https://github.com/org/repo-b", title: "repo-b", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 5 }) },  // UNCHANGED
    { url: "https://github.com/org/repo-d", title: "repo-d", type: "IMPLEMENTATION", metadata: JSON.stringify({ stars: 0 }) },  // NEW (repo-c is REMOVED)
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "github" });
  assert.strictEqual(result.summary.new, 1, "Expected 1 NEW");
  assert.strictEqual(result.summary.updated, 1, "Expected 1 UPDATED");
  assert.strictEqual(result.summary.removed, 1, "Expected 1 REMOVED");
  assert.strictEqual(result.summary.unchanged, 1, "Expected 1 UNCHANGED");
});

// ============================================================
// TEST 6 — Identical Rerun Idempotency
// ============================================================
asyncTest("TEST 6: Re-running comparison produces no duplicate ResearchSignals", async () => {
  const space = await prisma.researchSpace.findFirst();
  const source = await prisma.source.findFirst({ where: { name: "arxiv" } });

  const testColA = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 2 },
  });
  const testColB = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 3 },
  });

  const prev = [
    { url: "https://arxiv.org/abs/2101.11111", title: "Test Paper 1", type: "PAPER" },
    { url: "https://arxiv.org/abs/2101.22222", title: "Test Paper 2", type: "PAPER" },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2101.11111", title: "Test Paper 1", type: "PAPER" },
    { url: "https://arxiv.org/abs/2101.22222", title: "Test Paper 2", type: "PAPER" },
    { url: "https://arxiv.org/abs/2101.33333", title: "Test Paper 3 (New)", type: "PAPER" },
  ];

  const comp = compareArtifactSets(prev, curr, {
    sourceId: source.id,
    sourceName: "arxiv",
    previousCollectionId: testColA.id,
    currentCollectionId: testColB.id,
  });

  // First run
  const run1 = await generateSignalsFromComparison(comp, prisma);
  assert.strictEqual(run1.created, 1, "First run should create 1 signal");
  assert.strictEqual(run1.existing, 0);

  // Second run (identical comparison)
  const run2 = await generateSignalsFromComparison(comp, prisma);
  assert.strictEqual(run2.created, 0, "Second run should create 0 duplicate signals");
  assert.strictEqual(run2.existing, 1, "Second run should recognize existing signal");

  // Clean up test collections and signals
  await prisma.researchSignal.deleteMany({
    where: { researchSpaceId: space.id, evidence: { contains: testColB.id } },
  });
  await prisma.collection.deleteMany({
    where: { id: { in: [testColA.id, testColB.id] } },
  });
});

// ============================================================
// TEST 7 — Failed Collection Safety
// ============================================================
asyncTest("TEST 7: Failed collection is safely rejected without generating false REMOVED signals", async () => {
  const source = await prisma.source.findFirst({ where: { name: "github" } });

  const successfulCol = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 10 },
  });
  const failedCol = await prisma.collection.create({
    data: { sourceId: source.id, status: "FAILED", errorMessage: "Rate limit / scraper error", recordCount: 0 },
  });

  const comparison = await compareCollections(successfulCol, failedCol, prisma);
  assert.strictEqual(comparison.eligible, false, "Failed collection must not be eligible for comparison");
  assert(comparison.error.includes("failed"), "Error message should mention collection failure");
  assert.strictEqual(comparison.summary.removed, 0, "Failed collection must NEVER generate false removed signals");

  // Clean up
  await prisma.collection.deleteMany({
    where: { id: { in: [successfulCol.id, failedCol.id] } },
  });
});

// ============================================================
// TEST 8 — Same URL With Modified Metadata
// ============================================================
test("TEST 8: Same URL identity with changed metadata creates UPDATED signal", () => {
  const url = "https://arxiv.org/abs/2010.15396";
  const prev = [
    { url, title: "Paper V1", type: "PAPER", description: "Initial abstract", metadata: JSON.stringify({ authors: ["Alice"] }) },
  ];
  const curr = [
    { url: "https://arxiv.org/abs/2010.15396/", title: "Paper V2 (Updated)", type: "PAPER", description: "Updated abstract", metadata: JSON.stringify({ authors: ["Alice", "Bob"] }) },
  ];

  const result = compareArtifactSets(prev, curr, { sourceName: "arxiv" });
  assert.strictEqual(result.summary.new, 0, "Must not create a new duplicate artifact identity");
  assert.strictEqual(result.summary.removed, 0);
  assert.strictEqual(result.summary.updated, 1, "Must detect as UPDATED");
  assert(result.updatedArtifacts[0].changes.length >= 2, "Must capture title and author changes");
});

// ============================================================
// TEST 9 — Source Isolation
// ============================================================
asyncTest("TEST 9: Cross-source comparisons are strictly rejected", async () => {
  const arxivSource = await prisma.source.findFirst({ where: { name: "arxiv" } });
  const githubSource = await prisma.source.findFirst({ where: { name: "github" } });

  const arxivCol = await prisma.collection.create({
    data: { sourceId: arxivSource.id, status: "SUCCESS", recordCount: 5 },
  });
  const githubCol = await prisma.collection.create({
    data: { sourceId: githubSource.id, status: "SUCCESS", recordCount: 5 },
  });

  const comparison = await compareCollections(arxivCol, githubCol, prisma);
  assert.strictEqual(comparison.eligible, false, "Cross-source comparison must be rejected");
  assert(comparison.error.includes("different sources"), "Error must mention source mismatch");

  // Clean up
  await prisma.collection.deleteMany({
    where: { id: { in: [arxivCol.id, githubCol.id] } },
  });
});

// ============================================================
// TEST 10 — Provenance & Relationship Enrichment
// ============================================================
asyncTest("TEST 10: ResearchSignals preserve provenance chain and enrich relationship links", async () => {
  const space = await prisma.researchSpace.findFirst();
  const githubSource = await prisma.source.findFirst({ where: { name: "github" } });

  // Find a known implementation artifact that is linked to a paper in the database
  const knownRel = await prisma.relationship.findFirst({
    where: { relationshipType: "IMPLEMENTED_BY" },
    include: { sourceArtifact: true, targetArtifact: true },
  });
  assert(knownRel, "Database should contain at least one known relationship for testing");

  const testColA = await prisma.collection.create({
    data: { sourceId: githubSource.id, status: "SUCCESS", recordCount: 0 },
  });
  const testColB = await prisma.collection.create({
    data: { sourceId: githubSource.id, status: "SUCCESS", recordCount: 1 },
  });

  // Simulate discovering this repo as a NEW artifact
  const prev = [];
  const curr = [
    {
      url: knownRel.targetArtifact.url,
      title: knownRel.targetArtifact.title,
      type: "IMPLEMENTATION",
    },
  ];

  const comp = compareArtifactSets(prev, curr, {
    sourceId: githubSource.id,
    sourceName: "github",
    previousCollectionId: testColA.id,
    currentCollectionId: testColB.id,
  });

  const signalResult = await generateSignalsFromComparison(comp, prisma);
  assert.strictEqual(signalResult.created, 1);

  const signal = signalResult.signals[0];
  assert.strictEqual(signal.type, "NEW");
  assert(signal.description.includes(knownRel.sourceArtifact.title), "Signal description should mention linked paper title");

  const evidence = parseEvidence(signal.evidence);
  assert.strictEqual(evidence.sourceId, githubSource.id);
  assert.strictEqual(evidence.currentCollectionId, testColB.id);
  assert(evidence.relationship, "Evidence must include relationship metadata");
  assert.strictEqual(evidence.relationship.paperTitle, knownRel.sourceArtifact.title);

  // Clean up
  await prisma.researchSignal.deleteMany({
    where: { id: signal.id },
  });
  await prisma.collection.deleteMany({
    where: { id: { in: [testColA.id, testColB.id] } },
  });
});

async function runQueue() {
  console.log("\n============================================================");
  console.log("RUNNING RETRACE PHASE 1 TEST SUITE");
  console.log("============================================================\n");

  for (const t of testQueue) {
    total++;
    try {
      if (t.isAsync) {
        await t.fn();
      } else {
        t.fn();
      }
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${err.message}`);
    }
  }

  await prisma.$disconnect();
  console.log("\n============================================================");
  console.log(`PHASE 1 TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");
  if (passed !== total) {
    process.exit(1);
  }
}

runQueue().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
