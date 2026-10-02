const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const bySource = await prisma.artifact.groupBy({
    by: ['source'],
    _count: { source: true },
    orderBy: { source: 'asc' },
  });

  const total = await prisma.artifact.count();
  const missing = await prisma.artifact.count({ where: { publishedAt: null } });
  const missingBySource = await prisma.$queryRaw`
    SELECT source, COUNT(*) AS missing_date_count
    FROM Artifact
    WHERE publishedAt IS NULL
    GROUP BY source
    ORDER BY source ASC;
  `;

  const normalizedNearDupes = await prisma.$queryRaw`
    WITH normalized AS (
      SELECT
        LOWER(
          TRIM(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(url, 'https://', ''),
                      'http://', ''
                    ),
                    'www.', ''
                  ),
                  '#', ''
                ),
                '?', ''
              ),
              '&', ''
            )
          )
        ) AS norm_url,
        source
      FROM Artifact
      WHERE url IS NOT NULL
    )
    SELECT norm_url, COUNT(*) AS dupes
    FROM normalized
    GROUP BY norm_url
    HAVING COUNT(*) > 1
    LIMIT 20;
  `;

  console.log(JSON.stringify({
    bySource: bySource.map((row) => ({ source: row.source, count: Number(row._count.source) })),
    total,
    missing,
    missingBySource: missingBySource.map((row) => ({
      source: row.source,
      missing_date_count: Number(row.missing_date_count),
    })),
    normalizedNearDupes,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
