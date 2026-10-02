const assert = require("assert");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { buildSnapshotPayload, computeContentHash } = require("../src/ingestion/snapshot");
const { scorePaperRepoPair, findCandidateMatches, tokenize, keywordOverlap } = require("../src/matching/similarity");

let passed = 0;
let total = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn, isAsync: false });
}

function asyncTest(name, fn) {
  testQueue.push({ name, fn, isAsync: true });
}

async function runQueue() {
  console.log("\n============================================================");
  console.log("RUNNING RETRACE PIPELINE TEST SUITE");
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
  console.log(`PIPELINE TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");
  if (passed !== total) {
    process.exit(1);
  }
}

// ============================================================
// 1. SIMILARITY SCORING TESTS
// ============================================================
console.log("--- 1. Similarity Scoring ---");

test("Tokenize strips short tokens and stopwords", () => {
  const tokens = tokenize("A Deep Learning Approach to OTFS Channel Estimation");
  assert(tokens.includes("deep"), "Should include 'deep'");
  assert(tokens.includes("learning"), "Should include 'learning'");
  assert(tokens.includes("approach"), "Should include 'approach'");
  assert(!tokens.includes("a"), "Should not include stopword 'a'");
  assert(!tokens.includes("to"), "Should not include stopword 'to'");
});

test("keywordOverlap returns correct Jaccard score and shared terms", () => {
  const a = ["deep", "learning", "neural"];
  const b = ["deep", "learning", "network"];
  const { score, shared } = keywordOverlap(a, b);
  assert(score > 0, "Score should be > 0 for overlapping tokens");
  assert(shared.includes("deep"), "Should share 'deep'");
  assert(shared.includes("learning"), "Should share 'learning'");
  assert.strictEqual(shared.length, 2, "Should have exactly 2 shared terms");
});

test("scorePaperRepoPair returns higher confidence for stronger matches", () => {
  const strongPaper = {
    title: "Deep Learning for OTFS Channel Estimation",
    description: "We propose a deep learning based channel estimation method for OTFS systems",
    url: "https://arxiv.org/abs/1234.5678",
    metadata: { authors: ["Alice Smith", "Bob Jones"] },
  };
  const strongRepo = {
    title: "Deep Learning OTFS Channel Estimation",
    description: "Implementation of deep learning based channel estimation for OTFS",
    url: "https://github.com/alice/dl-otfs-chan-est",
    metadata: { owner: "alice" },
  };
  const weakRepo = {
    title: "WiFi Signal Processing Toolkit",
    description: "General purpose signal processing utilities for wireless communications",
    url: "https://github.com/someone/wifi-tools",
    metadata: { owner: "someone" },
  };

  const strongResult = scorePaperRepoPair(strongPaper, strongRepo);
  const weakResult = scorePaperRepoPair(strongPaper, weakRepo);

  assert(strongResult.confidence > weakResult.confidence,
    `Strong match (${strongResult.confidence}) should score higher than weak match (${weakResult.confidence})`);
  assert(strongResult.evidence.length > 0, "Strong match should have evidence");
});

test("Author overlap bonus increases confidence", () => {
  const paper = {
    title: "Novel Estimation Method",
    description: "A novel method for estimation",
    url: "https://arxiv.org/abs/1111.2222",
    metadata: { authors: ["Hassan Ali"] },
  };
  const repoWithAuthor = {
    title: "Completely Different Title",
    description: "This is about something else but by Hassan Ali",
    url: "https://github.com/hassan/different-project",
    metadata: { owner: "hassan" },
  };
  const repoWithoutAuthor = {
    title: "Completely Different Title",
    description: "This is about something else entirely",
    url: "https://github.com/someone/different-project",
    metadata: { owner: "someone" },
  };

  const withAuthor = scorePaperRepoPair(paper, repoWithAuthor);
  const withoutAuthor = scorePaperRepoPair(paper, repoWithoutAuthor);

  assert(withAuthor.confidence >= withoutAuthor.confidence,
    "Author overlap should increase or maintain confidence");
});

test("findCandidateMatches returns sorted results above threshold", () => {
  const papers = [
    { title: "Alpha Paper", description: "First paper about alpha", url: "https://arxiv.org/1", metadata: {} },
    { title: "Beta Paper", description: "Second paper about beta", url: "https://arxiv.org/2", metadata: {} },
  ];
  const repos = [
    { title: "Alpha Implementation", description: "Implementation of alpha paper", url: "https://github.com/1", metadata: {} },
    { title: "Unrelated Project", description: "Something completely different", url: "https://github.com/2", metadata: {} },
  ];

  const matches = findCandidateMatches(papers, repos, 0.05);
  assert(matches.length >= 1, "Should find at least 1 match");
  // Results should be sorted by confidence descending
  for (let i = 1; i < matches.length; i++) {
    assert(matches[i - 1].confidence >= matches[i].confidence, "Results should be sorted by confidence");
  }
});

// ============================================================
// 2. PIPELINE INTEGRITY TESTS
// ============================================================
console.log("\n--- 2. Pipeline Integration ---");

asyncTest("Pipeline: loadRawRecords handles missing files gracefully", () => {
  const { loadRawRecords } = require("../src/services/pipelineService");
  const result = loadRawRecords({ rawFilePath: "/nonexistent/path.json" });
  assert(Array.isArray(result), "Should return array");
  assert.strictEqual(result.length, 0, "Should return empty array for missing file");
});

asyncTest("Pipeline: loadRawRecords handles null rawFilePath", () => {
  const { loadRawRecords } = require("../src/services/pipelineService");
  const result = loadRawRecords({ rawFilePath: null });
  assert(Array.isArray(result), "Should return array");
  assert.strictEqual(result.length, 0, "Should return empty array for null path");
});

asyncTest("Pipeline: runPipeline rejects non-SUCCESS collections", async () => {
  const { runPipeline } = require("../src/services/pipelineService");
  // Create a test collection with FAILED status
  const source = await prisma.source.findFirst({ where: { name: "arxiv" } });
  assert(source, "arxiv source should exist");

  const testCol = await prisma.collection.create({
    data: { sourceId: source.id, status: "FAILED", recordCount: 0 },
  });

  const result = await runPipeline(prisma, testCol.id);
  assert.strictEqual(result.success, false, "Should fail for FAILED collection");

  await prisma.collection.delete({ where: { id: testCol.id } });
});

asyncTest("Pipeline: getChangeSummary returns valid structure", async () => {
  const { getChangeSummary } = require("../src/services/pipelineService");
  const space = await prisma.researchSpace.findFirst();
  assert(space, "Research space should exist");

  const summary = await getChangeSummary(prisma, space.id);
  assert(typeof summary === "object", "Should return object");
  assert(typeof summary.new === "number", "new should be number");
  assert(typeof summary.updated === "number", "updated should be number");
  assert(typeof summary.removed === "number", "removed should be number");
  assert(typeof summary.signalsCount === "number", "signalsCount should be number");
});

asyncTest("Pipeline: getChangeSummary handles null spaceId", async () => {
  const { getChangeSummary } = require("../src/services/pipelineService");
  const summary = await getChangeSummary(prisma, null);
  assert.strictEqual(summary.new, 0);
  assert.strictEqual(summary.updated, 0);
  assert.strictEqual(summary.removed, 0);
  assert.strictEqual(summary.hasComparison, false);
});

// ============================================================
// 3. EXPORT FORMAT TESTS
// ============================================================
console.log("\n--- 3. Artifact Notes & Review ---");

asyncTest("PATCH: notes field persists on artifact", async () => {
  const space = await prisma.researchSpace.findFirst();
  const source = await prisma.source.findFirst({ where: { name: "arxiv" } });

  // Create a test artifact
  const art = await prisma.artifact.create({
    data: {
      researchSpaceId: space.id,
      type: "PAPER",
      title: "Test Notes Artifact",
      description: "Test",
      url: "https://arxiv.org/abs/notes-test",
      source: "arxiv",
      metadata: "{}",
    },
  });

  // Update notes
  const updated = await prisma.artifact.update({
    where: { id: art.id },
    data: { notes: "Important research note", reviewedAt: new Date() },
  });

  assert.strictEqual(updated.notes, "Important research note", "Notes should persist");
  assert(updated.reviewedAt instanceof Date, "reviewedAt should be a Date");

  // Cleanup
  await prisma.artifact.delete({ where: { id: art.id } });
});

runQueue().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
