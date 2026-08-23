# ReTrace

Turns fragmented public research-web data into a connected, browsable research landscape — built with Bright Data Scraper Studio for **Into the Scrape-Verse** (WeMakeDevs × Bright Data).

## The problem

Research information for a topic is scattered across papers, code repositories, datasets, and lab pages. There's no single place to see what exists, and no way to know what's changed since you last looked. ReTrace uses Bright Data's self-healing scrapers to continuously monitor public research sources and turn what they return into a connected, queryable dataset — resilient to the fact that these pages change structure over time.

Demo topic: **OTFS (Orthogonal Time Frequency Space)**, a wireless-communications research area — this is genuinely the topic of my own internship research, not a synthetic demo case.

## What's built and working right now

- **Two live Bright Data collectors**, created via Scraper Studio and triggered through the real `/dca/trigger` + `/dca/dataset` API (not just the dashboard UI): arXiv (`c_mt4ot19f1crygiarf6`) and GitHub (`c_mt4p886y15pmyqfts`).
- **164 real papers** collected for "OTFS channel estimation," normalized into a common artifact schema, deduplicated, and stored with version history in a SQLite database via Prisma.
- **A working dashboard** (`frontend/dashboard.html`) — no build step, no server — showing live source health (Collector IDs + status), an overview of collected artifacts, and a searchable literature matrix across all 164 real papers with real titles, authors, publication dates, and links.
- **Raw-first ingestion**: every collector response is saved untouched before any transformation, so the pipeline can be reprocessed without re-scraping.

## Self-healing — validated, honestly reported

Self-healing is Scraper Studio's core reliability mechanism, and we tested it directly rather than assuming it works:

We built a controlled fixture page (a small static site we fully control: `github.com/saad0O5/ReTrace-Fixture`), pointed a collector at it, then deliberately restructured the page's HTML — different tags, different classes, different nesting — to force a real extraction failure. The break was confirmed: the collector kept "succeeding" at the API level but every extracted field came back empty, an important finding in itself (failure here is silent, not an error — a system built on top of this needs to check field completeness, not just HTTP status).

We then triggered Bright Data's Self-Healing. The dashboard correctly diagnosed the structural change and generated accurate new selectors, verified with a live preview showing correctly re-extracted data. The final publish step encountered a transient platform error ("Could not connect to preview server") during our testing window, which we couldn't clear before submission — but the core mechanism (AI diagnosis of a real structural break, correct fix generation, verified accurate re-extraction in preview) is confirmed working end to end.

## What's not in this submission

GitHub's search results proved resistant to reliable scraping in the time available (rate-limiting/bot-detection related), so GitHub data isn't included in this submission's dataset despite the collector existing and being configured. Paper-to-repository relationship matching, the full analytics layer, and additional artifact types (datasets, benchmarks, projects, resources) are designed into the architecture (see `docs/architecture.md`) but not built in this timeframe — this is a real tool I intend to keep developing for my own research use after the hackathon.

## Running it

```bash
cd backend && npm install
cp .env.example .env   # fill in your Bright Data API token + collector IDs
npx prisma generate && npx prisma db push
node scripts/testCollector.js arxiv "your topic"
node scripts/ingestRaw.js backend/raw/<the-file-it-saved>.json
node scripts/exportDashboard.js
# open frontend/dashboard.html in a browser
```

## Architecture

Full pipeline and phased build plan: [`docs/architecture.md`](docs/architecture.md). Checkpoint report: [`docs/checkpoint-a.md`](docs/checkpoint-a.md).