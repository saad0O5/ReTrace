# Checkpoint A — Complete

**Status:** ✅ Done
**Definition (from the roadmap):** Bright Data → Collector → JSON → Backend. Prove the connection works end to end before building anything downstream of it.

## What this checkpoint proves

- Bright Data Scraper Studio is correctly integrated: real collectors created, triggered, and polled to completion via the actual `/dca/trigger` + `/dca/dataset` API — not the dashboard UI.
- The database schema is live and receiving real data, not just designed on paper.
- Raw responses are preserved untouched before any transformation, so the ingestion layer can be re-run or fixed without re-scraping.
- Normalization was built against real, observed data — including the messy parts (compound IDs, missing fields) — not against assumptions.

## Concrete results

| Metric | Value |
|---|---|
| Collectors created | 2 (arXiv, GitHub) |
| Collector IDs | `c_mt4ot19f1crygiarf6` (arXiv), `c_mt4p886y15pmyqfts` (GitHub) |
| Real records pulled | 164 (arXiv, topic: "OTFS channel estimation") |
| Records normalized + stored as Artifacts | 164 |
| Duplicates on ingest | 0 (fresh dataset) |
| Records missing `published_date` | 39 of 164 (~24%) — confirmed real, not a bug |
| GitHub collector pulled for real data | Not yet — next session |

## Architecture as it stands right now

```
Topic: "OTFS channel estimation"
        │
        ▼
sources.config.js  (urlTemplate + resolveSourceInput)
        │
        ▼
brightdata.js  → POST /dca/trigger?collector=<id>&queue_next=1
        │           body: [{ "url": "<resolved URL>" }]
        ▼
        poll GET /dca/dataset?id=<snapshot>
        │
        ▼
Raw JSON saved untouched → backend/raw/*.json
        │
        ▼
normalizer.js  (normalizeArxivRecord)
   - extracts clean arXiv ID from the URL, not the messy arxiv_id field
   - parses version number when present
   - leaves publishedAt = null when the source data has no date (39/164 cases)
        │
        ▼
ingestRaw.js
   - dedupes by URL against existing Artifact rows
   - writes new Artifact + ArtifactVersion rows
   - updates lastSeen on already-known artifacts
        │
        ▼
SQLite (dev.db) — ResearchSpace → Source → Collection → Artifact → ArtifactVersion
```

## Files delivered this checkpoint

```
backend/
  package.json
  .env.example
  prisma/schema.prisma          (7 models, SQLite-compatible — no native enums)
  src/
    server.js                   (Express app, seeds ResearchSpace/Sources, /api/collect endpoint)
    database/client.js          (Prisma client singleton)
    collectors/
      brightdata.js             (trigger / poll / heal wrapper against the real API)
      sources.config.js         (arxiv + github source definitions, resolveSourceInput helper)
    ingestion/
      normalizer.js             (normalizeArxivRecord, built against real observed data)
scripts/
  testCollector.js              (standalone Bright Data connection sanity check)
  ingestRaw.js                  (raw JSON → normalized, deduplicated, versioned DB rows)
README.md
docs/architecture.md            (full pipeline + phase breakdown)
```

## What's confirmed working

- ✅ `bdata` CLI install, login (via API key), and scraper creation
- ✅ Real trigger/poll cycle against Bright Data's actual API (not assumed shape)
- ✅ SQLite + Prisma schema, seeding, and writes
- ✅ Raw-first storage pattern
- ✅ Normalization against real field names and real data gaps
- ✅ Deduplication and version history on ingest

## What's explicitly NOT yet validated

- ⬜ `bdata scraper heal` — the single highest-risk unknown in the whole architecture, and still untested. This was flagged early as the first thing to validate; it's been deferred through all of Checkpoint A and should be the first thing tackled next, before more ingestion work compounds on top of an unverified assumption.
- ⬜ GitHub collector's real output shape — assumed similar to arXiv's, not confirmed.
- ⬜ Paper↔repo matching (Phase 5) — no code written yet.
- ⬜ Any UI — nothing rendered yet, by design (backend-first per the roadmap).

## Issues hit and resolved this checkpoint (see `build-log-day1.md` for full detail)

1. Prisma enums unsupported on SQLite → converted to documented `String` fields
2. `bdata` CLI not installed / wrong install method tried first → `npm install -g @brightdata/cli`
3. OAuth browser login succeeded but local callback failed → resolved via `bdata login --api-key`
4. Trigger input assumed to be `{topic}`, actually `{url}` → confirmed via dashboard, fixed
5. `dotenv` not found in `scripts/` → pointed at `backend/node_modules/dotenv` explicitly
6. Server's seed function referenced stale `sources.config.js` fields after a refactor → fixed field names

## Recommended next session

Start with `bdata scraper heal` validation — not more ingestion work — since everything else in the roadmap assumes it behaves as documented, and that assumption has not yet been tested once.