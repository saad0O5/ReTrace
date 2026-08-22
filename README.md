# ReTrace

Turns fragmented public research-web data into a connected, continuously updated research landscape.

Pick a research topic and a set of public sources; Bright Data Scraper Studio collects them; ReTrace normalizes the results into research artifacts (papers, implementations, datasets, benchmarks, projects, resources), connects related ones (a paper to its GitHub implementation, its dataset, its benchmark), tracks what changes between scans, and surfaces that as a literature matrix and research-activity signals.

If a source website changes structure and a collector breaks, Bright Data's self-healing repairs it in place — same Collector ID, pipeline keeps running.

Built for **Into the Scrape-Verse** (WeMakeDevs × Bright Data).

## Status

🚧 Checkpoint A in progress — Bright Data connection, database schema, and raw collection storage. No normalization, matching, or UI yet. See `docs/architecture.md` for the full build plan and checkpoint definitions.

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Fill in `backend/.env`:
- `BRIGHTDATA_API_TOKEN` — from your Bright Data account
- `BRIGHTDATA_ARXIV_COLLECTOR_ID`, `BRIGHTDATA_GITHUB_COLLECTOR_ID` — see step 3

### 3. Create your collectors
Using the Bright Data CLI (`bdata`):
```bash
bdata scraper create "https://arxiv.org/search/?query={topic}" "paper title, authors, abstract, published date, url, arxiv id"
bdata scraper create "https://github.com/search?q={topic}&type=repositories" "repo name, owner, description, url, language, stars, last updated"
```
Each command returns a Collector ID (`c_xxxx`). Paste them into `backend/.env`.

### 4. Set up the database
```bash
cd backend
npx prisma generate
npx prisma db push
```

### 5. Sanity-check the Bright Data connection (do this before starting the server)
```bash
node scripts/testCollector.js arxiv "OTFS channel estimation"
```
Inspect the saved JSON under `backend/raw/` — confirm the field names actually returned before writing anything that depends on them.

### 6. Run the backend
```bash
cd backend
npm run dev
```
```bash
curl -X POST http://localhost:5000/api/collect/arxiv -H "Content-Type: application/json" -d '{"topic":"OTFS channel estimation"}'
```

## Project structure

See `docs/architecture.md` for the full pipeline and phase-by-phase build order.

## Self-healing

When a source's page structure changes and a collector starts failing:
```bash
bdata scraper heal <collector_id> "<what broke, be specific>" --url <url>
bdata scraper approve <collector_id>
```
The Collector ID stays the same — nothing downstream needs to change.
