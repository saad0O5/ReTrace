const { PrismaClient } = require('C:/Users/SkyLinks/Desktop/ReTrace/backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const [researchSpaces, sources, collections, artifacts, versions, relationships, signals] = await Promise.all([
    prisma.researchSpace.count(),
    prisma.source.count(),
    prisma.collection.count(),
    prisma.artifact.count(),
    prisma.artifactVersion.count(),
    prisma.relationship.count(),
    prisma.researchSignal.count(),
  ]);
  console.log(JSON.stringify({ researchSpaces, sources, collections, artifacts, versions, relationships, signals }, null, 2));
  const sourceRows = await prisma.source.findMany({ include: { collections: { orderBy: { startedAt: 'desc' } } } });
  console.log('SOURCE_ROWS');
  console.log(JSON.stringify(sourceRows.map((s) => ({
    name: s.name,
    collectorId: s.collectorId,
    status: s.status,
    lastRun: s.lastRun,
    lastSuccessAt: s.lastSuccessAt,
    totalCollections: s.collections.length,
    latest: s.collections[0] ? { status: s.collections[0].status, startedAt: s.collections[0].startedAt, recordCount: s.collections[0].recordCount } : null,
  })), null, 2));
  const artifactStats = await prisma.artifact.groupBy({ by: ['type'], _count: { type: true } });
  console.log('ARTIFACT_TYPE_COUNTS');
  console.log(JSON.stringify(artifactStats, null, 2));
  const pubDateCounts = { withDate: await prisma.artifact.count({ where: { publishedAt: { not: null } } }), missingDate: await prisma.artifact.count({ where: { publishedAt: null } }) };
  console.log('PUB_DATE_COUNTS');
  console.log(JSON.stringify(pubDateCounts, null, 2));
  const signalsRows = await prisma.researchSignal.findMany({ take: 10, orderBy: { createdAt: 'desc' } });
  console.log('SIGNALS_SAMPLE');
  console.log(JSON.stringify(signalsRows, null, 2));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
