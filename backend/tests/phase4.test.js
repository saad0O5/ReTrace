const assert = require("assert");
const { normalizeArtifactType, isSupportedArtifactType, getArtifactTypeLabel } = require("../src/artifacts/artifactTypes");
const { normalizeDatasetRecord, normalizeResourceRecord, normalizeProjectRecord } = require("../src/ingestion/normalizer");
const { buildSnapshotPayload, computeContentHash } = require("../src/ingestion/snapshot");

function makeDataset(overrides = {}) {
  return {
    dataset_name: "OTFS Benchmark Dataset",
    description: "A benchmark dataset for OTFS channel estimation experiments.",
    url: "https://example.org/datasets/otfs-benchmark?utm_source=promo",
    owner: "Example Lab",
    organization: "Example University",
    size: "2.4 GB",
    format: "CSV",
    license: "CC-BY-4.0",
    updated_date: "2025-01-01",
    download_url: "https://example.org/datasets/otfs-benchmark/download",
    ...overrides,
  };
}

function makeResource(overrides = {}) {
  return {
    title: "OTFS Benchmark Notes",
    url: "https://example.org/resources/otfs-notes#intro",
    description: "Technical notes for OTFS evaluation and benchmarking.",
    owner: "Example Lab",
    resource_type: "benchmark",
    updated_at: "2025-02-01",
    ...overrides,
  };
}

function makeProject(overrides = {}) {
  return {
    project_name: "OTFS Research Project",
    description: "Combined project landing page for OTFS research work.",
    url: "https://example.org/projects/otfs",
    owner: "Example Lab",
    affiliation: "Example University",
    ...overrides,
  };
}

let passed = 0;
let total = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log("\n============================================================");
  console.log("RUNNING RETRACE PHASE 4 TEST SUITE");
  console.log("============================================================\n");

  for (const t of tests) {
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
  console.log(`PHASE 4 TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("============================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

test("Artifact type validation accepts supported types and normalizes case", () => {
  assert.strictEqual(normalizeArtifactType("paper"), "PAPER");
  assert.strictEqual(normalizeArtifactType("dataset"), "DATASET");
  assert.strictEqual(normalizeArtifactType("project"), "PROJECT");
  assert.strictEqual(isSupportedArtifactType("RESOURCE"), true);
  assert.strictEqual(isSupportedArtifactType("EVENT"), false);
});

test("Artifact type labels are readable", () => {
  assert.strictEqual(getArtifactTypeLabel("DATASET"), "Dataset");
  assert.strictEqual(getArtifactTypeLabel("RESOURCE"), "Resource");
  assert.strictEqual(getArtifactTypeLabel("PAPER"), "Paper");
});

test("Dataset normalization preserves canonical URL and metadata", () => {
  const dataset = normalizeDatasetRecord(makeDataset());
  assert.strictEqual(dataset.type, "DATASET");
  assert.strictEqual(dataset.title, "OTFS Benchmark Dataset");
  assert.strictEqual(dataset.url, "https://example.org/datasets/otfs-benchmark");
  assert.strictEqual(dataset.source, "dataset");
  assert.strictEqual(dataset.metadata.includes("\"owner\":\"Example Lab\""), true);
});

test("Dataset normalization tolerates missing optional fields", () => {
  const dataset = normalizeDatasetRecord({ title: "Minimal dataset", url: "https://example.org/data" });
  assert.strictEqual(dataset.type, "DATASET");
  assert.strictEqual(dataset.url, "https://example.org/data");
  assert.strictEqual(dataset.metadata.includes("\"rawUrl\":\"https://example.org/data\""), true);
});

test("Dataset snapshot is deterministic", () => {
  const dataset = normalizeDatasetRecord(makeDataset());
  const payloadA = buildSnapshotPayload(dataset);
  const hashA = computeContentHash(payloadA);
  const payloadB = buildSnapshotPayload(normalizeDatasetRecord(makeDataset()));
  const hashB = computeContentHash(payloadB);
  assert.strictEqual(hashA, hashB);
  assert.strictEqual(payloadA.type, "DATASET");
});

test("Dataset change detection catches updated metadata", () => {
  const prev = normalizeDatasetRecord(makeDataset());
  const curr = normalizeDatasetRecord(makeDataset({ size: "3.5 GB", license: "MIT" }));
  const prevPayload = buildSnapshotPayload(prev);
  const currPayload = buildSnapshotPayload(curr);
  assert.notStrictEqual(computeContentHash(prevPayload), computeContentHash(currPayload));
  assert.strictEqual(curr.metadata.includes("\"size\":\"3.5 GB\""), true);
});

test("Resource normalization accepts generic research resources", () => {
  const resource = normalizeResourceRecord(makeResource());
  assert.strictEqual(resource.type, "RESOURCE");
  assert.strictEqual(resource.title, "OTFS Benchmark Notes");
  assert.strictEqual(resource.url, "https://example.org/resources/otfs-notes");
  assert.strictEqual(resource.metadata.includes("\"resourceType\":\"benchmark\""), true);
});

test("Project normalization creates a distinct project artifact", () => {
  const project = normalizeProjectRecord(makeProject());
  assert.strictEqual(project.type, "PROJECT");
  assert.strictEqual(project.title, "OTFS Research Project");
  assert.strictEqual(project.url, "https://example.org/projects/otfs");
  assert.strictEqual(project.source, "project");
});

test("Generic artifact metadata never crashes on missing optional fields", () => {
  const dataset = normalizeDatasetRecord({ url: "https://example.org/data/empty" });
  assert.strictEqual(dataset.title, "(untitled dataset)");
  assert.strictEqual(dataset.type, "DATASET");
  const resource = normalizeResourceRecord({ url: "https://example.org/resource" });
  assert.strictEqual(resource.type, "RESOURCE");
});

test("Source-compatible artifact type system remains backward compatible", () => {
  assert.strictEqual(normalizeArtifactType("IMPLEMENTATION"), "IMPLEMENTATION");
  assert.strictEqual(normalizeArtifactType("PAPER"), "PAPER");
  assert.strictEqual(isSupportedArtifactType("DATASET"), true);
});

run();
