const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
});

const { PrismaClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient();

function inferArxivDateFromId(arxivId) {
  if (!arxivId) return null;
  const match = String(arxivId).match(/^(\d{2})(\d{2})\.(\d{4,5})(?:v\d+)?$/i);
  if (!match) return null;
  const [, yearPrefix] = match;
  const yearNumber = Number(yearPrefix);
  const inferredYear = yearNumber >= 90 ? 1900 + yearNumber : 2000 + yearNumber;
  if (!Number.isInteger(inferredYear) || inferredYear < 1990) return null;
  return new Date(Date.UTC(inferredYear, 0, 1));
}

function parseMetadata(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

function inferDateForArtifact(artifact) {
  if (artifact.publishedAt) return artifact.publishedAt;

  const metadata = parseMetadata(artifact.metadata);

  if (artifact.source === 'arxiv') {
    const fromMeta = metadata.arxivId || metadata.rawArxivId || null;
    const fromUrl = artifact.url && String(artifact.url).match(/\/abs\/([^/?#]+)/);
    const arxivId = fromMeta || (fromUrl ? fromUrl[1] : null);
    return inferArxivDateFromId(arxivId);
  }

  if (artifact.source === 'duke-calderbank') {
    const candidates = [
      metadata.year,
      metadata.publicationYear,
      metadata.publication_year,
      metadata.rawRecord?.year,
      metadata.rawRecord?.publication_year,
      artifact.metadata && artifact.metadata.match(/\b(19|20)\d{2}\b/),
    ];

    const yearMatch = candidates
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .find((v) => typeof v === 'string' || typeof v === 'number');

    if (yearMatch) {
      const year = Number(String(yearMatch).match(/(19|20)\d{2}/)?.[0]);
      if (Number.isInteger(year)) {
        return new Date(Date.UTC(year, 0, 1));
      }
    }
  }

  return null;
}

async function backfill() {
  const rows = await prisma.artifact.findMany({
    where: { publishedAt: null },
    select: { id: true, source: true, url: true, metadata: true, publishedAt: true },
  });

  let updated = 0;
  for (const artifact of rows) {
    const inferred = inferDateForArtifact(artifact);
    if (inferred) {
      await prisma.artifact.update({
        where: { id: artifact.id },
        data: { publishedAt: inferred },
      });
      updated++;
    }
  }

  const remaining = await prisma.artifact.count({ where: { publishedAt: null } });
  const total = await prisma.artifact.count();
  const remainingBySource = await prisma.$queryRaw`SELECT source, COUNT(*) AS missing_date_count FROM Artifact WHERE publishedAt IS NULL GROUP BY source ORDER BY source;`;

  console.log(JSON.stringify({
    rowsChecked: rows.length,
    updated,
    remaining,
    total,
    remainingBySource: remainingBySource.map((row) => ({
      source: row.source,
      missing_date_count: Number(row.missing_date_count),
    })),
  }, null, 2));
}

backfill()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
