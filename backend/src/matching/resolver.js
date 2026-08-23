// Runs paper<->repo matching against whatever's currently in the database and
// persists results as Relationship rows. Idempotent: re-running updates
// confidence/evidence on existing pairs instead of duplicating them, so this
// is safe to call again after a fresh ingest without piling up duplicate rows.
//
// Called from scripts/matchRepos.js — this module owns the logic, the script
// is a thin CLI entry point, matching the pattern used by ingestRaw.js.

const { PrismaClient } = require("@prisma/client");
const { findCandidateMatches } = require("./similarity");

const prisma = new PrismaClient();

// Below this, matches are single-generic-keyword noise (see similarity.js test
// output — anything under ~0.12 in this dataset was just "sensing" shared).
// Kept configurable rather than hardcoded in findCandidateMatches so this
// threshold is a matching-policy decision, not a scoring-math one.
const CONFIDENCE_THRESHOLD = 0.1;

async function run() {
  const space = await prisma.researchSpace.findFirst({ where: { name: "OTFS Channel Estimation" } });
  if (!space) {
    console.error("No ResearchSpace found. Run the backend once so it seeds one, then retry.");
    process.exit(1);
  }

  const papers = await prisma.artifact.findMany({
    where: { researchSpaceId: space.id, type: "PAPER" },
  });
  const repos = await prisma.artifact.findMany({
    where: { researchSpaceId: space.id, type: "IMPLEMENTATION" },
  });

  console.log(`Matching ${papers.length} papers against ${repos.length} repositories...`);

  if (papers.length === 0 || repos.length === 0) {
    console.log("Nothing to match yet — ingest both sources first.");
    await prisma.$disconnect();
    return;
  }

  const candidates = findCandidateMatches(papers, repos, CONFIDENCE_THRESHOLD);
  console.log(`Found ${candidates.length} candidate matches at or above confidence ${CONFIDENCE_THRESHOLD}.`);

  let created = 0;
  let updated = 0;

  for (const c of candidates) {
    const existing = await prisma.relationship.findFirst({
      where: {
        sourceArtifactId: c.paper.id,
        targetArtifactId: c.repo.id,
        relationshipType: "IMPLEMENTED_BY",
      },
    });

    const data = {
      confidence: c.confidence,
      evidence: JSON.stringify(c.evidence),
    };

    if (existing) {
      await prisma.relationship.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.relationship.create({
        data: {
          sourceArtifactId: c.paper.id,
          targetArtifactId: c.repo.id,
          relationshipType: "IMPLEMENTED_BY",
          ...data,
        },
      });
      created++;
    }
  }

  console.log(`Relationships: ${created} created, ${updated} updated.`);
  console.log("\nTop matches:");
  candidates.slice(0, 5).forEach((c) => {
    console.log(`  [${c.confidence}] "${c.paper.title}" <-> "${c.repo.title}"`);
  });

  await prisma.$disconnect();
}

module.exports = { run };