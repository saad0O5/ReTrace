// Runs paper<->repo matching against whatever's currently in the database and
// persists results as Relationship rows. Idempotent: re-running updates
// confidence/evidence on existing pairs instead of duplicating them, so this
// is safe to call again after a fresh ingest without piling up duplicate rows.
//
// matchRelationships() is the reusable core — called from pipelineService.js
// after every ingest. run() is the legacy CLI entry point for scripts/matchRepos.js.

const { PrismaClient } = require("@prisma/client");
const { findCandidateMatches } = require("./similarity");

// Below this, matches are single-generic-keyword noise (see similarity.js test
// output — anything under ~0.12 in this dataset was just "sensing" shared).
// Kept configurable rather than hardcoded in findCandidateMatches so this
// threshold is a matching-policy decision, not a scoring-math one.
const CONFIDENCE_THRESHOLD = 0.1;

/**
 * Matches papers against implementations for a given research space and
 * persists Relationship rows. Safe to call repeatedly (idempotent).
 *
 * @param {object} prismaClient - Prisma client instance
 * @param {string} researchSpaceId - ID of the ResearchSpace
 * @returns {Promise<{created: number, updated: number, candidates: number}>}
 */
async function matchRelationships(prismaClient, researchSpaceId) {
  if (!researchSpaceId) return { created: 0, updated: 0, candidates: 0 };

  const papers = await prismaClient.artifact.findMany({
    where: { researchSpaceId, type: "PAPER" },
  });
  const repos = await prismaClient.artifact.findMany({
    where: { researchSpaceId, type: "IMPLEMENTATION" },
  });

  if (papers.length === 0 || repos.length === 0) {
    return { created: 0, updated: 0, candidates: 0 };
  }

  const candidates = findCandidateMatches(papers, repos, CONFIDENCE_THRESHOLD);
  let created = 0;
  let updated = 0;

  for (const c of candidates) {
    const existing = await prismaClient.relationship.findFirst({
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
      await prismaClient.relationship.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prismaClient.relationship.create({
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

  return { created, updated, candidates: candidates.length };
}

/**
 * Legacy CLI entry point — used by scripts/matchRepos.js.
 * Creates its own PrismaClient and looks up the default space.
 */
async function run() {
  const prisma = new PrismaClient();
  const space = await prisma.researchSpace.findFirst({ where: { name: "OTFS Channel Estimation" } });
  if (!space) {
    console.error("No ResearchSpace found. Run the backend once so it seeds one, then retry.");
    process.exit(1);
  }

  const result = await matchRelationships(prisma, space.id);
  console.log(`Matching complete: ${result.candidates} candidates, ${result.created} created, ${result.updated} updated.`);
  await prisma.$disconnect();
}

module.exports = { run, matchRelationships };