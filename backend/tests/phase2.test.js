const assert = require("assert");
const { PrismaClient } = require("@prisma/client");
const { normalizeCalderbankRecord, normalizeArxivRecord, normalizeGithubRecord } = require("../src/ingestion/normalizer");
const { buildSnapshotPayload, computeContentHash } = require("../src/ingestion/snapshot");
const { compareArtifactSets, compareCollections } = require("../src/analysis/changeDetector");
const { generateSignalsFromComparison } = require("../src/analysis/signalService");

const prisma = new PrismaClient();

async function ensureDukeSource() {
  const space = await prisma.researchSpace.findFirst({ where: { name: "OTFS Channel Estimation" } });
  if (!space) return null;

  const existing = await prisma.source.findFirst({ where: { researchSpaceId: space.id, name: "duke-calderbank" } });
  if (existing) return existing;

  return prisma.source.create({
    data: {
      researchSpaceId: space.id,
      name: "duke-calderbank",
      baseUrl: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications",
      collectorId: "",
      artifactTypes: "PAPER",
      status: "CONFIGURED",
    },
  });
}

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
  console.log("RUNNING RETRACE PHASE 2 TEST SUITE");
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
  console.log(`PHASE 2 TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");
  if (passed !== total) {
    process.exit(1);
  }
}

const rawDuke = {
  title: "OTFS with Delay-Doppler Learning",
  authors: ["Robert Calderbank", "A. B. Smith"],
  year: 2024,
  venue: "Duke Math Journal",
  doi: "10.1000/example",
  url: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications?paper=1&utm_source=duke",
  sourcePageUrl: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications",
  description: "A publication page record from Duke.",
};

test("Duke normalizer accepts the actual Bright Data response shape", () => {
  const record = normalizeCalderbankRecord({
    title: "Hierarchical Coding for Cloud Storage: Topology-Adaptivity, Scalability, and Flexibility",
    authors: "Yang, S; Hareedy, A; Calderbank, R; Dolecek, L",
    journal: "IEEE Transactions on Information Theory",
    publication_date: "June, 2022",
    doi: "10.1109/TIT.2022.3149454",
    publication_url: "http://dx.doi.org/10.1109/TIT.2022.3149454",
    product_page_url: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications/384506",
    input: { url: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications" },
  });

  assert.strictEqual(record.type, "PAPER");
  assert.strictEqual(record.title, "Hierarchical Coding for Cloud Storage: Topology-Adaptivity, Scalability, and Flexibility");
  assert.strictEqual(record.source, "duke-calderbank");
  assert.strictEqual(record.url, "http://dx.doi.org/10.1109/TIT.2022.3149454");
  const meta = JSON.parse(record.metadata);
  assert.deepStrictEqual(meta.authors, ["Yang, S", "Hareedy, A", "Calderbank, R", "Dolecek, L"]);
  assert.strictEqual(meta.venue, "IEEE Transactions on Information Theory");
  assert.strictEqual(meta.doi, "10.1109/TIT.2022.3149454");
  assert.strictEqual(meta.sourcePageUrl, "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications/384506");
});

test("Duke normalizer extracts title properly", () => {
  const record = normalizeCalderbankRecord(rawDuke);
  assert.strictEqual(record.type, "PAPER");
  assert.strictEqual(record.title, "OTFS with Delay-Doppler Learning");
  assert.strictEqual(record.source, "duke-calderbank");
});

test("Duke normalizer preserves provenance and canonical URL", () => {
  const record = normalizeCalderbankRecord(rawDuke);
  assert.strictEqual(record.url, "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications?paper=1");
  const meta = JSON.parse(record.metadata);
  assert.strictEqual(meta.rawUrl, "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications?paper=1&utm_source=duke");
  assert.strictEqual(meta.sourcePageUrl, "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications");
  assert.strictEqual(meta.doi, "10.1000/example");
});

test("Duke normalizer handles missing optional fields without crashing", () => {
  const record = normalizeCalderbankRecord({
    title: "Sparse OTFS Systems",
    authors: ["A. Author"],
    sourcePageUrl: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications",
  });
  assert.strictEqual(record.type, "PAPER");
  assert.strictEqual(record.title, "Sparse OTFS Systems");
  assert.strictEqual(record.publishedAt, null);
  assert.strictEqual(record.description, null);
  const meta = JSON.parse(record.metadata);
  assert.strictEqual(meta.venue, null);
  assert.strictEqual(meta.doi, null);
});

test("Duke snapshot payload and hash are deterministic", () => {
  const obs1 = normalizeCalderbankRecord(rawDuke);
  const obs2 = normalizeCalderbankRecord({
    ...rawDuke,
    authors: [...rawDuke.authors].sort(),
    url: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications?paper=1&utm_medium=web",
    sourcePageUrl: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications",
  });

  const payload1 = buildSnapshotPayload(obs1);
  const payload2 = buildSnapshotPayload(obs2);
  assert.strictEqual(computeContentHash(payload1), computeContentHash(payload2));
  assert.strictEqual(payload1.title, "OTFS with Delay-Doppler Learning");
  assert.deepStrictEqual(payload1.authors, ["A. B. Smith", "Robert Calderbank"]);
});

test("Changed Duke observations produce a different snapshot hash", () => {
  const obs1 = normalizeCalderbankRecord(rawDuke);
  const obs2 = normalizeCalderbankRecord({
    ...rawDuke,
    title: "OTFS with Delay-Doppler Learning (Revised)",
    venue: "Duke Applied Math Review",
  });

  const hash1 = computeContentHash(buildSnapshotPayload(obs1));
  const hash2 = computeContentHash(buildSnapshotPayload(obs2));
  assert.notStrictEqual(hash1, hash2);
});

test("Duke observations compare as source-isolated updates and no false removal", () => {
  const prev = [normalizeCalderbankRecord({ ...rawDuke, title: "OTFS with Delay-Doppler Learning" })];
  const curr = [normalizeCalderbankRecord({ ...rawDuke, title: "OTFS with Delay-Doppler Learning (Revised)" })];

  const result = compareArtifactSets(prev, curr, { sourceName: "duke-calderbank" });
  assert.strictEqual(result.summary.updated, 1);
  assert.strictEqual(result.summary.new, 0);
  assert.strictEqual(result.summary.removed, 0);
});

asyncTest("Duke collection failures do not create false REMOVED signals", async () => {
  const space = await prisma.researchSpace.findFirst();
  let source = await prisma.source.findFirst({ where: { name: "duke-calderbank" } });
  if (!source) {
    source = await ensureDukeSource();
  }

  if (!source) {
    throw new Error("Duke source must exist for this test");
  }

  const previous = await prisma.collection.create({
    data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 },
  });
  const failed = await prisma.collection.create({
    data: { sourceId: source.id, status: "FAILED", recordCount: 0, errorMessage: "Duke selector omitted fields" },
  });

  const comparison = await compareCollections(previous, failed, prisma);
  assert.strictEqual(comparison.eligible, false);
  assert.strictEqual(comparison.summary.removed, 0);

  await prisma.collection.deleteMany({ where: { id: { in: [previous.id, failed.id] } } });
  if (space) {
    await prisma.researchSignal.deleteMany({ where: { researchSpaceId: space.id, description: { contains: "Duke" } } });
  }
});

asyncTest("Existing arXiv and GitHub ingestion paths still normalize records", async () => {
  const arxiv = normalizeArxivRecord({
    paper_title: "A test paper",
    authors: ["Alice", "Bob"],
    abstract: "Summary",
    url: "https://arxiv.org/abs/2401.00001/?utm_source=feed",
    arxiv_id: "2401.00001 arXiv:2401.00001v2",
    published_date: "2024-01-02",
  });
  const github = normalizeGithubRecord({
    repo_name: "otfs-future",
    owner: "research-org",
    description: "Implementation details",
    url: "https://github.com/research-org/otfs-future.git",
    stars: 3,
  });

  assert.strictEqual(arxiv.type, "PAPER");
  assert.strictEqual(github.type, "IMPLEMENTATION");
  assert.strictEqual(arxiv.url, "https://arxiv.org/abs/2401.00001");
  assert.strictEqual(github.url, "https://github.com/research-org/otfs-future");
});

asyncTest("Duke source can participate in change detection and create a signal", async () => {
  let source = await prisma.source.findFirst({ where: { name: "duke-calderbank" } });
  if (!source) {
    source = await ensureDukeSource();
  }
  if (!source) {
    throw new Error("Duke source must exist for this test");
  }

  const prevCol = await prisma.collection.create({ data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 } });
  const currCol = await prisma.collection.create({ data: { sourceId: source.id, status: "SUCCESS", recordCount: 1 } });

  const prev = [normalizeCalderbankRecord({ ...rawDuke, title: "OTFS with Delay-Doppler Learning" })];
  const curr = [normalizeCalderbankRecord({ ...rawDuke, title: "OTFS with Delay-Doppler Learning (Updated)" })];

  const comparison = compareArtifactSets(prev, curr, {
    sourceId: source.id,
    sourceName: "duke-calderbank",
    previousCollectionId: prevCol.id,
    currentCollectionId: currCol.id,
  });

  const result = await generateSignalsFromComparison(comparison, prisma);
  assert.strictEqual(result.created, 1);

  await prisma.researchSignal.deleteMany({
    where: { evidence: { contains: currCol.id } },
  });
  await prisma.collection.deleteMany({
    where: { id: { in: [prevCol.id, currCol.id] } },
  });
});

runQueue().catch((err) => {
  console.error("Phase 2 test execution failed:", err);
  process.exit(1);
});
