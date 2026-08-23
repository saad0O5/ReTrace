// Exports everything currently in the database into a plain JS file the
// dashboard can load with a simple <script> tag - no server, no build step,
// no CORS issues from opening an HTML file directly.
//
// Usage: node scripts/exportDashboard.js
// Re-run this any time the DB changes and refresh the dashboard in the browser.

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});
const fs = require("fs");
const { PrismaClient } = require(path.join(__dirname, "..", "backend", "node_modules", "@prisma", "client"));

const prisma = new PrismaClient();

async function main() {
  const space = await prisma.researchSpace.findFirst();
  const sources = await prisma.source.findMany();
  const artifacts = await prisma.artifact.findMany({ orderBy: { publishedAt: "desc" } });

  const overview = {};
  for (const a of artifacts) {
    overview[a.type] = (overview[a.type] || 0) + 1;
  }

  const data = {
    generatedAt: new Date().toISOString(),
    researchSpace: space ? { name: space.name, topic: space.topic } : null,
    sources: sources.map((s) => ({
      name: s.name,
      collectorId: s.collectorId,
      status: s.status,
      lastRun: s.lastRun,
      lastSuccessAt: s.lastSuccessAt,
    })),
    overview,
    totalArtifacts: artifacts.length,
    artifacts: artifacts.map((a) => {
      const meta = JSON.parse(a.metadata || "{}");
      return {
        title: a.title,
        type: a.type,
        url: a.url,
        publishedAt: a.publishedAt,
        authors: meta.authors || [],
      };
    }),
  };

  const outDir = path.join(__dirname, "..", "frontend");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "dashboard-data.js");
  fs.writeFileSync(outPath, `window.RETRACE_DATA = ${JSON.stringify(data, null, 2)};\n`);

  console.log(`Exported ${artifacts.length} artifacts to ${outPath}`);
  console.log(`Overview: ${JSON.stringify(overview)}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Export failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});