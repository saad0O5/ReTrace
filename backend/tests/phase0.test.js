const assert = require("assert");
const { normalizeUrl, TRACKING_PARAMS } = require("../src/ingestion/urlNormalizer");
const { normalizeArxivRecord, normalizeGithubRecord } = require("../src/ingestion/normalizer");
const { buildSnapshotPayload, computeContentHash } = require("../src/ingestion/snapshot");
const { deriveSourceHealth } = require("../src/database/sourceHealth");

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
  console.log("RUNNING RETRACE PHASE 0 TEST SUITE");
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
  console.log(`TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");
  if (passed !== total) {
    process.exit(1);
  }
}

// ============================================================
// 1. URL NORMALIZATION TESTS (Phase 0.1)
// ============================================================
console.log("--- 1. URL Normalization ---");

test("Trailing slash normalization (arXiv)", () => {
  const urlWithSlash = "https://arxiv.org/abs/2010.15396/";
  const urlWithoutSlash = "https://arxiv.org/abs/2010.15396";
  assert.strictEqual(normalizeUrl(urlWithSlash), urlWithoutSlash);
});

test("Trailing slash normalization (GitHub)", () => {
  const urlWithSlash = "https://github.com/hassiweb/otfs-chan-est-and-eq/";
  const urlWithoutSlash = "https://github.com/hassiweb/otfs-chan-est-and-eq";
  assert.strictEqual(normalizeUrl(urlWithSlash), urlWithoutSlash);
});

test("Fragment stripping (#readme, #section)", () => {
  const urlWithHash = "https://github.com/owner/repo#readme";
  const expected = "https://github.com/owner/repo";
  assert.strictEqual(normalizeUrl(urlWithHash), expected);
});

test("Harmless tracking parameter stripping (utm_*, fbclid, gclid, trk, _ga, ref)", () => {
  const dirtyUrl =
    "https://github.com/owner/repo?utm_source=twitter&utm_medium=social&utm_campaign=launch&fbclid=12345&ref=hackathon";
  const expected = "https://github.com/owner/repo";
  assert.strictEqual(normalizeUrl(dirtyUrl), expected);
});

test("Whitespace trimming (leading, trailing, newlines)", () => {
  const paddedUrl = "  \n https://arxiv.org/abs/2010.15396 \t \r\n";
  const expected = "https://arxiv.org/abs/2010.15396";
  assert.strictEqual(normalizeUrl(paddedUrl), expected);
});

test("Already-normalized URL remains unchanged (idempotence)", () => {
  const cleanUrl = "https://arxiv.org/abs/2010.15396";
  assert.strictEqual(normalizeUrl(cleanUrl), cleanUrl);
  assert.strictEqual(normalizeUrl(normalizeUrl(cleanUrl)), cleanUrl);
});

test("Critical query parameters are NOT stripped (search queries, pagination, IDs)", () => {
  const queryUrl = "https://arxiv.org/search/?query=OTFS&searchtype=all&order=-announced_date_first";
  const normalized = normalizeUrl(queryUrl);
  assert(normalized.includes("query=OTFS"), "Should retain query param");
  assert(normalized.includes("searchtype=all"), "Should retain searchtype param");
  assert(normalized.includes("order=-announced_date_first"), "Should retain order param");
});

test("Query parameters are deterministically sorted", () => {
  const urlA = "https://example.com/search?b=2&a=1&c=3";
  const urlB = "https://example.com/search?c=3&a=1&b=2";
  assert.strictEqual(normalizeUrl(urlA), "https://example.com/search?a=1&b=2&c=3");
  assert.strictEqual(normalizeUrl(urlA), normalizeUrl(urlB));
});

test("Protocol & hostname casing normalization", () => {
  const mixedCaseUrl = "HTTPS://ArXiV.OrG/abs/2010.15396";
  const expected = "https://arxiv.org/abs/2010.15396";
  assert.strictEqual(normalizeUrl(mixedCaseUrl), expected);
});

test("GitHub .git suffix removal", () => {
  const gitUrl = "https://github.com/owner/repo.git";
  const expected = "https://github.com/owner/repo";
  assert.strictEqual(normalizeUrl(gitUrl), expected);
});

test("Default port stripping (:443 for https, :80 for http)", () => {
  const portUrl = "https://arxiv.org:443/abs/2010.15396";
  const expected = "https://arxiv.org/abs/2010.15396";
  assert.strictEqual(normalizeUrl(portUrl), expected);
});

test("Null and invalid input handling", () => {
  assert.strictEqual(normalizeUrl(null), null);
  assert.strictEqual(normalizeUrl(""), null);
  assert.strictEqual(normalizeUrl("   "), null);
});

// ============================================================
// 2. PROVENANCE & NORMALIZER TESTS (Phase 0.2)
// ============================================================
console.log("\n--- 2. Provenance & Normalizer ---");

test("arXiv normalizer uses normalized URL and preserves rawUrl in metadata", () => {
  const rawRecord = {
    paper_title: "Channel Estimation in OTFS",
    abstract: "A study on channel estimation.",
    url: "https://arxiv.org/abs/2010.15396/?utm_source=feed",
    arxiv_id: "2010.15396 arXiv:2010.15396v1",
    published_date: "2020-10-30",
    authors: ["Alice", "Bob"],
  };

  const normalized = normalizeArxivRecord(rawRecord);
  assert.strictEqual(normalized.type, "PAPER");
  assert.strictEqual(normalized.url, "https://arxiv.org/abs/2010.15396");

  const meta = JSON.parse(normalized.metadata);
  assert.strictEqual(meta.rawUrl, "https://arxiv.org/abs/2010.15396/?utm_source=feed");
  assert.strictEqual(meta.arxivId, "2010.15396");
  assert.deepStrictEqual(meta.authors, ["Alice", "Bob"]);
});

test("GitHub normalizer uses normalized URL and preserves rawUrl in metadata", () => {
  const rawRecord = {
    repo_name: "otfs-chan-est-and-eq",
    owner: "hassiweb",
    description: "Equalization and simulation in Python",
    url: "https://github.com/hassiweb/otfs-chan-est-and-eq.git",
    stars: 12,
  };

  const normalized = normalizeGithubRecord(rawRecord);
  assert.strictEqual(normalized.type, "IMPLEMENTATION");
  assert.strictEqual(normalized.url, "https://github.com/hassiweb/otfs-chan-est-and-eq");

  const meta = JSON.parse(normalized.metadata);
  assert.strictEqual(meta.rawUrl, "https://github.com/hassiweb/otfs-chan-est-and-eq.git");
  assert.strictEqual(meta.owner, "hassiweb");
  assert.strictEqual(meta.stars, 12);
});

// ============================================================
// 3. ARTIFACT VERSION SNAPSHOT TESTS (Phase 0.3)
// ============================================================
console.log("\n--- 3. ArtifactVersion Snapshots ---");

test("Snapshot payload extraction is deterministic", () => {
  const paper = {
    type: "PAPER",
    title: "  OTFS Estimation  ",
    description: "Description text",
    url: "https://arxiv.org/abs/2010.15396/",
    publishedAt: new Date("2020-10-30T00:00:00Z"),
    metadata: JSON.stringify({ authors: ["Bob", "Alice"], arxivId: "2010.15396" }),
  };

  const payload = buildSnapshotPayload(paper);
  assert.strictEqual(payload.title, "OTFS Estimation");
  assert.strictEqual(payload.url, "https://arxiv.org/abs/2010.15396");
  assert.deepStrictEqual(payload.authors, ["Alice", "Bob"], "Authors should be sorted");
});

test("Identical observations produce identical content hashes", () => {
  const obs1 = {
    type: "PAPER",
    title: "Paper Title",
    description: "Abstract",
    url: "https://arxiv.org/abs/2010.15396",
    publishedAt: "2020-10-30T00:00:00.000Z",
    metadata: JSON.stringify({ authors: ["Alice", "Bob"], arxivId: "2010.15396" }),
  };

  const obs2 = {
    type: "PAPER",
    title: "Paper Title",
    description: "Abstract",
    url: "https://arxiv.org/abs/2010.15396/",
    publishedAt: new Date("2020-10-30T00:00:00.000Z"),
    metadata: JSON.stringify({ authors: ["Bob", "Alice"], arxivId: "2010.15396" }),
  };

  const hash1 = computeContentHash(buildSnapshotPayload(obs1));
  const hash2 = computeContentHash(buildSnapshotPayload(obs2));
  assert.strictEqual(hash1, hash2, "Identical content with different ordering/formatting must produce same hash");
});

test("Changed observations produce different content hashes", () => {
  const obsOriginal = {
    type: "PAPER",
    title: "Original Title",
    description: "Original Abstract",
    url: "https://arxiv.org/abs/2010.15396",
    metadata: JSON.stringify({ authors: ["Alice"], arxivId: "2010.15396" }),
  };

  const obsUpdated = {
    type: "PAPER",
    title: "Updated Title with New Findings",
    description: "Expanded abstract with new results",
    url: "https://arxiv.org/abs/2010.15396",
    metadata: JSON.stringify({ authors: ["Alice", "Bob"], arxivId: "2010.15396" }),
  };

  const hashOriginal = computeContentHash(buildSnapshotPayload(obsOriginal));
  const hashUpdated = computeContentHash(buildSnapshotPayload(obsUpdated));
  assert.notStrictEqual(hashOriginal, hashUpdated, "Different content must produce different hashes");
});

// ============================================================
// 4. SOURCE HEALTH TESTS (Phase 0.4)
// ============================================================
console.log("\n--- 4. Source Health ---");

test("Source with successful collection is HEALTHY with accurate record count and timestamps", () => {
  const source = {
    id: "src-1",
    name: "github",
    collectorId: "c_mt5yn9lvrgrgdp5vm",
    baseUrl: "https://github.com",
    artifactTypes: "IMPLEMENTATION",
  };

  const collections = [
    {
      id: "col-1",
      sourceId: "src-1",
      status: "SUCCESS",
      recordCount: 10,
      startedAt: new Date("2026-08-23T17:08:00Z"),
      completedAt: new Date("2026-08-23T17:08:14Z"),
      errorMessage: null,
    },
  ];

  const health = deriveSourceHealth(source, collections);
  assert.strictEqual(health.status, "HEALTHY");
  assert.strictEqual(health.recordCount, 10);
  assert.strictEqual(health.errorMessage, null);
  assert.strictEqual(health.totalCollections, 1);
});

test("Source with failed collection is EXTRACTION_FAILED with error message", () => {
  const source = {
    id: "src-2",
    name: "github",
    collectorId: "c_mt5yn9lvrgrgdp5vm",
    baseUrl: "https://github.com",
    artifactTypes: "IMPLEMENTATION",
  };

  const collections = [
    {
      id: "col-2",
      sourceId: "src-2",
      status: "FAILED",
      recordCount: 0,
      startedAt: new Date("2026-08-23T17:15:00Z"),
      completedAt: new Date("2026-08-23T17:15:05Z"),
      errorMessage: "Rate limit exceeded / scraper selector changed",
    },
  ];

  const health = deriveSourceHealth(source, collections);
  assert.strictEqual(health.status, "EXTRACTION_FAILED");
  assert.strictEqual(health.recordCount, 0);
  assert.strictEqual(health.errorMessage, "Rate limit exceeded / scraper selector changed");
});

test("Successful collection with zero records is not treated as healthy", () => {
  const source = {
    id: "src-2b",
    name: "github",
    collectorId: "c_mt5yn9lvrgrgdp5vm",
    baseUrl: "https://github.com",
    artifactTypes: "IMPLEMENTATION",
  };

  const collections = [
    {
      id: "col-2b",
      sourceId: "src-2b",
      status: "SUCCESS",
      recordCount: 0,
      startedAt: new Date("2026-08-23T17:18:00Z"),
      completedAt: new Date("2026-08-23T17:18:07Z"),
      errorMessage: null,
    },
  ];

  const health = deriveSourceHealth(source, collections);
  assert.notStrictEqual(health.status, "HEALTHY");
  assert.strictEqual(health.status, "DRIFTING");
  assert.strictEqual(health.recordCount, 0);
});

test("Configured source that has never run is CONFIGURED, not falsely HEALTHY", () => {
  const source = {
    id: "src-3",
    name: "arxiv",
    collectorId: "c_mt4ot19f1crygiarf6",
    baseUrl: "https://arxiv.org",
    artifactTypes: "PAPER",
    lastRun: null,
    lastSuccessAt: null,
  };

  const health = deriveSourceHealth(source, []);
  assert.strictEqual(health.status, "CONFIGURED");
  assert.strictEqual(health.recordCount, 0);
  assert.strictEqual(health.lastRun, null);
  assert.strictEqual(health.lastSuccessAt, null);
});

test("Fixture source is identified as TEST SOURCE", () => {
  const source = {
    id: "src-4",
    name: "fixture",
    collectorId: "c_mt5c4xao29ue6pvc89",
    baseUrl: "https://saad0o5.github.io/ReTrace-Fixture/",
    artifactTypes: "PAPER",
  };

  const health = deriveSourceHealth(source, []);
  assert.strictEqual(health.status, "TEST SOURCE");
});

// ============================================================
// 5. DATABASE & EXPORT INTEGRITY TESTS (Integration)
// ============================================================
console.log("\n--- 5. Database & Exporter Integrity ---");

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

asyncTest("Database contains the live Duke-augmented baseline: arXiv/GitHub preserved, Duke papers ingested", async () => {
  const totalArtifacts = await prisma.artifact.count();
  const papers = await prisma.artifact.count({ where: { type: "PAPER" } });
  const repos = await prisma.artifact.count({ where: { type: "IMPLEMENTATION" } });
  const totalVersions = await prisma.artifactVersion.count();
  const relationships = await prisma.relationship.count();
  const sources = await prisma.source.count();
  const dukeSource = await prisma.source.findFirst({ where: { name: "duke-calderbank" } });
  const dukeArtifacts = await prisma.artifact.count({ where: { source: "duke-calderbank" } });

  assert.strictEqual(totalArtifacts, 652, `Expected 652 artifacts, got ${totalArtifacts}`);
  assert.strictEqual(papers, 642, `Expected 642 papers, got ${papers}`);
  assert.strictEqual(repos, 10, `Expected 10 implementations, got ${repos}`);
  assert.strictEqual(totalVersions, 655, `Expected 655 versions, got ${totalVersions}`);
  assert.strictEqual(relationships, 19, `Expected 19 relationships, got ${relationships}`);
  assert.strictEqual(sources, 7, `Expected 7 sources, got ${sources}`);
  assert.strictEqual(dukeArtifacts > 0, true, "Duke source should have ingested real paper artifacts");
  assert(dukeSource, "Duke source row should exist in the seeded baseline");
  assert.strictEqual(dukeSource.collectorId, "c_mtisrrzwxyapkvgvt", "Duke collector ID should match the real configured collector");
});

asyncTest("Active Bright Data Collector IDs are preserved", async () => {
  const arxiv = await prisma.source.findFirst({ where: { name: "arxiv" } });
  const github = await prisma.source.findFirst({ where: { name: "github" } });
  const fixture = await prisma.source.findFirst({ where: { name: "fixture" } });

  assert.strictEqual(arxiv.collectorId, "c_mt4ot19f1crygiarf6", "arXiv collector ID mismatch");
  assert.strictEqual(github.collectorId, "c_mt5yn9lvrgrgdp5vm", "GitHub collector ID mismatch");
  assert.strictEqual(fixture.collectorId, "c_mt5c4xao29ue6pvc89", "Fixture collector ID mismatch");
});

asyncTest("Provenance chain: Artifact -> ArtifactVersion -> Collection -> Source is intact", async () => {
  const sampleArtifact = await prisma.artifact.findFirst({
    include: {
      versions: {
        include: {
          collection: {
            include: {
              source: true,
            },
          },
        },
      },
    },
  });

  assert(sampleArtifact, "Sample artifact should exist");
  assert(sampleArtifact.versions.length >= 1, "Artifact must have at least 1 version");

  const v1 = sampleArtifact.versions[0];
  assert(v1.contentHash, "Version must have contentHash");
  assert(v1.collection, "Version must be linked to Collection");
  assert(v1.collection.source, "Collection must be linked to Source");
  assert(v1.collection.source.collectorId, "Source must have Bright Data collectorId");
});

asyncTest("End-to-end versioning: observation 1 -> identical (no dup) -> changed (version 2)", async () => {
  const space = await prisma.researchSpace.findFirst();
  const source = await prisma.source.findFirst({ where: { name: "arxiv" } });

  // 1. Create a test collection
  const testCol1 = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 },
  });

  const testUrl = "https://arxiv.org/abs/9999.99999";
  const obs1 = {
    researchSpaceId: space.id,
    type: "PAPER",
    title: "Test Observation V1",
    description: "Initial abstract",
    url: testUrl,
    source: "arxiv",
    metadata: JSON.stringify({ authors: ["Tester A"], arxivId: "9999.99999" }),
  };

  const payload1 = buildSnapshotPayload(obs1);
  const hash1 = computeContentHash(payload1);

  // First observation creates Artifact and Version 1
  const art = await prisma.artifact.create({
    data: { ...obs1 },
  });

  const ver1 = await prisma.artifactVersion.create({
    data: {
      artifactId: art.id,
      collectionId: testCol1.id,
      contentHash: hash1,
      metadata: JSON.stringify(payload1),
    },
  });

  assert.strictEqual(ver1.contentHash, hash1);

  // 2. Identical observation in collection 2
  const testCol2 = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 },
  });

  const obs2 = { ...obs1 }; // identical
  const payload2 = buildSnapshotPayload(obs2);
  const hash2 = computeContentHash(payload2);

  assert.strictEqual(hash2, hash1, "Identical observation must have identical hash");

  const latestVer = await prisma.artifactVersion.findFirst({
    where: { artifactId: art.id },
    orderBy: { observedAt: "desc" },
  });

  if (latestVer.contentHash === hash2) {
    // Identical: update lastSeen, do NOT create version
    await prisma.artifact.update({
      where: { id: art.id },
      data: { lastSeen: new Date() },
    });
  } else {
    await prisma.artifactVersion.create({
      data: { artifactId: art.id, collectionId: testCol2.id, contentHash: hash2, metadata: JSON.stringify(payload2) },
    });
  }

  const verCountAfterIdentical = await prisma.artifactVersion.count({ where: { artifactId: art.id } });
  assert.strictEqual(verCountAfterIdentical, 1, "Identical observation should NOT create duplicate version");

  // 3. Changed observation in collection 3
  const testCol3 = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 },
  });

  const obs3 = {
    ...obs1,
    title: "Test Observation V2 - Revised Title",
    description: "Updated abstract with new results",
  };
  const payload3 = buildSnapshotPayload(obs3);
  const hash3 = computeContentHash(payload3);

  assert.notStrictEqual(hash3, hash1, "Changed observation must produce different hash");

  await prisma.artifactVersion.create({
    data: {
      artifactId: art.id,
      collectionId: testCol3.id,
      contentHash: hash3,
      metadata: JSON.stringify(payload3),
    },
  });

  await prisma.artifact.update({
    where: { id: art.id },
    data: {
      title: obs3.title,
      description: obs3.description,
      lastSeen: new Date(),
      updatedAt: new Date(),
    },
  });

  const finalVersions = await prisma.artifactVersion.findMany({
    where: { artifactId: art.id },
    orderBy: { observedAt: "asc" },
  });

  assert.strictEqual(finalVersions.length, 2, "Modified observation must create Version 2");
  assert.strictEqual(finalVersions[0].contentHash, hash1);
  assert.strictEqual(finalVersions[1].contentHash, hash3);

  // Clean up test records so baseline remains pristine
  await prisma.artifactVersion.deleteMany({ where: { artifactId: art.id } });
  await prisma.artifact.delete({ where: { id: art.id } });
  await prisma.collection.deleteMany({ where: { id: { in: [testCol1.id, testCol2.id, testCol3.id] } } });
});

runQueue().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
