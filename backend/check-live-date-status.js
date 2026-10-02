const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const counts = {
    researchSpaces: await prisma.researchSpace.count(),
    sources: await prisma.source.count(),
    collections: await prisma.collection.count(),
    artifacts: await prisma.artifact.count(),
    versions: await prisma.artifactVersion.count(),
    relationships: await prisma.relationship.count(),
    signals: await prisma.researchSignal.count(),
  };

  const dates = {
    withDate: await prisma.artifact.count({ where: { publishedAt: { not: null } } }),
    missingDate: await prisma.artifact.count({ where: { publishedAt: null } }),
  };

  const sample = await prisma.artifact.findMany({
    where: { publishedAt: null },
    take: 5,
    select: { id: true, title: true, source: true, type: true, url: true, publishedAt: true, metadata: true },
  });

  console.log(JSON.stringify({ counts, dates, sample }, null, 2));
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
