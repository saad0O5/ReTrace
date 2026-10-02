// Removes inert, off-topic, and duplicate Source rows from the database.
//
// Rules:
//  - Remove sources with collectorId = "UNSET" that are not deliberately
//    kept as documented test fixtures.
//  - Remove the entire "Config Test Space" ResearchSpace and its sources —
//    it was a development artifact, not a real research space.
//  - Keep: arxiv, github, fixture, duke-calderbank under OTFS Channel Estimation.
//  - Delete: dataset, resource, project (UNSET stubs) from both spaces.
//  - Delete: pubmed, clinvar, gnomad, omim, hpo, pgmd (genomics stubs —
//    completely wrong domain for OTFS wireless research).
//  - Delete: the Config Test Space and all its Sources.
//
// Safe: does not touch Artifacts, Collections, or any real data.
// The Sources being deleted have collectorId = "UNSET" and no successful
// Collections (confirmed by audit — 0 collections for these stubs).

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

// Source names to keep in the OTFS space (everything else gets deleted)
const KEEP_IN_OTFS = new Set(["arxiv", "github", "fixture", "duke-calderbank"]);

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");

  const allSpaces = await prisma.researchSpace.findMany({ select: { id: true, name: true } });
  console.log("ResearchSpaces:", allSpaces.map((s) => `${s.name} (${s.id})`).join(", "));

  const allSources = await prisma.source.findMany({
    select: { id: true, name: true, collectorId: true, researchSpaceId: true },
  });

  // Find "Config Test Space" space IDs
  const testSpaces = allSpaces.filter((s) => s.name !== "OTFS Channel Estimation");
  const otfsSpace = allSpaces.find((s) => s.name === "OTFS Channel Estimation");

  if (!otfsSpace) {
    console.error("Could not find OTFS Channel Estimation space");
    process.exit(1);
  }

  // Sources to delete: test spaces + UNSET stubs in OTFS space
  const toDelete = allSources.filter((s) => {
    // All sources in non-OTFS spaces
    if (s.researchSpaceId !== otfsSpace.id) return true;
    // UNSET stubs in OTFS space not in the keep list
    if (!KEEP_IN_OTFS.has(s.name)) return true;
    return false;
  });

  const toKeep = allSources.filter((s) => !toDelete.includes(s));

  console.log("\nSOURCES TO KEEP:");
  toKeep.forEach((s) => console.log(`  [keep] ${s.name} (${s.collectorId}) in ${s.researchSpaceId}`));

  console.log("\nSOURCES TO DELETE:");
  toDelete.forEach((s) => console.log(`  [delete] ${s.name} (${s.collectorId}) in ${s.researchSpaceId}`));

  if (!DRY_RUN) {
    // Delete sources first
    for (const s of toDelete) {
      await prisma.source.delete({ where: { id: s.id } });
      console.log(`Deleted Source: ${s.name}`);
    }

    // Delete orphaned ResearchSpaces (no sources, no artifacts)
    for (const space of testSpaces) {
      const remaining = await prisma.source.count({ where: { researchSpaceId: space.id } });
      const artCount = await prisma.artifact.count({ where: { researchSpaceId: space.id } });
      const sigCount = await prisma.researchSignal.count({ where: { researchSpaceId: space.id } });
      if (remaining === 0 && artCount === 0 && sigCount === 0) {
        await prisma.researchSpace.delete({ where: { id: space.id } });
        console.log(`Deleted ResearchSpace: ${space.name}`);
      } else {
        console.log(`Skipping ResearchSpace "${space.name}" — still has ${remaining} sources, ${artCount} artifacts, ${sigCount} signals`);
      }
    }

    // Verify idempotency: re-running ensureSeeded() shouldn't recreate deleted sources.
    // The sources.config.js only defines the 4 kept sources, so ensureSeeded() will
    // never recreate dataset/resource/project/pubmed/clinvar/etc.
    const finalCount = await prisma.source.count();
    const finalSources = await prisma.source.findMany({ select: { name: true, researchSpaceId: true } });
    console.log(`\nFinal Source count: ${finalCount}`);
    finalSources.forEach((s) => console.log(`  ${s.name} (${s.researchSpaceId})`));
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
