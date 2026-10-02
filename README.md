# ReTrace

**ReTrace turns fragmented public research-web data into a connected, traceable research landscape.**

Built for **Into the Scrape-Verse — WeMakeDevs × Bright Data** using Bright Data Scraper Studio and Collector IDs.

> **Research should not end at a pile of search results. ReTrace traces the artifacts, connections, and changes that make a research field understandable.**

---

## 1. The Problem

A literature review is rarely just a search for papers.

For a research topic, useful evidence is fragmented across different public sources:

- papers and preprints
- implementation repositories
- datasets and benchmarks
- project pages and research resources
- release or update pages

The researcher has to repeatedly search these sources, compare results, identify which pieces belong together, and manually build a mental map of the field.

The problem becomes worse for a **living research topic**: the landscape changes continuously. New papers appear, repositories are created or updated, and relationships between artifacts become easier or harder to discover over time.

ReTrace addresses this narrower problem:

> **Continuously collect public research artifacts, normalize them into one structure, connect related artifacts, and present the resulting research landscape in a form that helps a researcher review and understand a topic.**

### Why web extraction matters

The useful information is not always exposed through one clean machine-readable API. Research information can be distributed across heterogeneous public pages and search interfaces. ReTrace therefore treats web extraction as a first-class part of the research-data pipeline rather than assuming every source already provides a convenient structured feed.

---

## 2. The Solution

ReTrace creates a **Research Space** around a topic.

A Research Space defines:

```text
Topic
  ↓
Selected public sources
  ↓
Bright Data Collector IDs
  ↓
Raw observations
  ↓
Normalized research artifacts
  ↓
Versioned snapshots & change detection
  ↓
Relationships between artifacts
  ↓
Research signals & analytics
  ↓
Research landscape + literature-review views
```

For the current demonstration, the Research Space is:

> **OTFS channel estimation**

This is a real research topic from a wireless-communications research internship, not a synthetic dataset chosen only for the demo.

The architecture is source-configurable, so the long-term product is not tied to OTFS, arXiv, or GitHub.

---

## 3. What ReTrace Does

### 3.1 Collect

ReTrace uses **Bright Data Scraper Studio** to collect public source data.

Each source is represented by a Bright Data **Collector ID**. The backend triggers the collector through Bright Data's data-collection API and polls the resulting snapshot.

```text
ReTrace
   ↓
Collector ID
   ↓
POST /dca/trigger
   ↓
Snapshot
   ↓
GET /dca/dataset
```

Collections can be triggered manually via the API, from the frontend Sources page, or on a configurable recurring schedule.

### 3.2 Preserve raw data

The original collector response is stored untouched before transformation.

This gives the pipeline a reproducible boundary:

```text
Raw observation
      ↓
Normalization
      ↓
Database
```

If the normalization logic changes, the raw observation does not need to be scraped again.

### 3.3 Normalize

Different sources use different field names and structures. ReTrace converts them into a common artifact model through source-specific normalizers.

The current model supports six artifact types:

| Type | Description | Source |
|---|---|---|
| **PAPER** | Academic papers and preprints | arXiv, Duke-Calderbank |
| **IMPLEMENTATION** | Code repositories | GitHub |
| **DATASET** | Dataset resources | (normalizer ready) |
| **BENCHMARK** | Benchmark suites | (normalizer ready) |
| **PROJECT** | Research projects | (normalizer ready) |
| **RESOURCE** | General research resources | (normalizer ready) |

The current live demonstration populates **PAPER** and **IMPLEMENTATION** artifacts. Support for **DATASET**, **RESOURCE**, and **PROJECT** artifacts exists in the schema, artifact-type system, and normalizer layer, but these are not yet populated from live sources.

Each source has a dedicated normalizer that handles its specific field quirks:

- **arXiv normalizer** — handles messy `arxiv_id` compound strings, infers `published_date` from the arXiv ID when the field is absent
- **GitHub normalizer** — reconstructs repository URLs from owner/name when the collector omits `url`, tolerates absent `description`
- **Duke-Calderbank normalizer** — handles heterogeneous Bright Data response shapes, extracts title/authors/year/venue/DOI from long-tail faculty pages

### 3.4 Data hygiene, identity normalization, and version snapshots

Artifacts are retained as persistent entities rather than treating every scrape as an isolated, duplicate record.

- **Identity & URL normalization:** A centralized, deterministic `normalizeUrl()` function normalizes whitespace, protocol/host casing, standard ports, URL fragments, `.git` suffixes, and trailing slashes, while stripping harmless tracking parameters (`utm_*`, `fbclid`, `gclid`, `trk`, `_ga`, `ref`) and sorting query parameters deterministically.
- **Provenance preservation:** Every artifact retains its original source URL in metadata and is strictly traceable through its relational chain: `Artifact` → `ArtifactVersion` → `Collection` → `Source` → `Bright Data Collector ID`.
- **Deterministic snapshotting:** Each observation computes a canonical snapshot payload and SHA-256 content hash. Identical re-observations only update `lastSeen` without polluting history with duplicate versions; genuine content changes create a new `ArtifactVersion` snapshot.
- **Dynamic source health:** Source status (`HEALTHY`, `DRIFTING`, `CONFIGURED`, `EXTRACTION_FAILED`, `TEST SOURCE`) is derived from actual collection run history rather than hardcoded configuration.

### 3.5 Research change detection & signals

ReTrace enables researchers to track how their research topic evolves across consecutive scans:

- **Source-isolated collection comparison:** Compares the latest successful collection with the previous successful collection for the same source.
- **Change categories:**
  - **`NEW`** — An artifact observed in the latest scan that did not appear in the prior baseline.
  - **`UPDATED`** — An artifact whose content hash changed between scans (e.g., revised preprint abstract, title changes, repository updates).
  - **`REMOVED`** — An artifact absent from the latest scan (phrased cautiously as *"not observed in latest scan"* rather than claiming deletion).
  - **`UNCHANGED`** — Identical observations that do not generate redundant noise.
- **Failed-collection safety:** If a scraper encounters rate limits or errors, the failed run is safely rejected, preserving the previous baseline without generating false "disappeared" alerts.
- **Idempotent ResearchSignals:** Transitions are persisted as `ResearchSignal` records with rich provenance evidence, enriched by existing paper ↔ implementation relationships.

### 3.6 Long-tail academic sources

ReTrace supports heterogeneous public research sources beyond the standard arXiv/GitHub path.

The live Duke long-tail source is:

```text
Robert Calderbank faculty publications page
https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications
```

This page yields 481 public research publication records from a real academic faculty page, not a custom API feed. ReTrace ingests these records and applies a topic-relevance filter at ingestion time — keeping only papers whose title/description contains OTFS-domain keywords — resulting in 84 on-topic papers. ReTrace treats it as a distinct source while preserving the same artifact model used elsewhere:

```text
SOURCE: duke-calderbank
ARTIFACT TYPE: PAPER
ARTIFACT: publication record from that page
```

The Duke normalizer preserves canonical URL identity, original/raw URL, title, authors, year, venue, DOI when present, and deterministic snapshot hash behavior for later change detection.

### 3.7 Connect research artifacts

ReTrace implements evidence-backed relationship resolution:

```text
Paper ── IMPLEMENTED_BY ──> Repository
```

The matcher produces a confidence score **and the evidence behind that score** rather than presenting an unexplained probability.

Current matching evidence includes:

- **Keyword overlap** — Jaccard similarity on tokenized title/description keywords
- **Author overlap** — bonus when paper authors appear in repository metadata
- **Domain affinity** — topic-specific keyword matching

These are **candidate relationships**, not semantic or scientific proofs. The interface and documentation therefore present evidence-backed linkage, not authoritatively declared implementation equivalence.

Relationship types supported: `IMPLEMENTED_BY`, `USES`, `EVALUATED_ON`, `PRODUCED_BY`, `REFERENCES`, `BENCHMARKED_BY`.

### 3.8 Analyze

The dashboard turns collected artifacts and signals into a research-oriented view:

- "Since Your Last Scan" delta metrics and research signals feed
- Source health and freshness indicators
- Artifact counts by type
- Paper/implementation coverage percentage
- Connected paper ↔ repository relationships with confidence
- Matching evidence transparency
- Searchable literature matrix
- Recent research activity signals
- Self-healing status and validation workflow
- Attention-scored review queue
- Keyword extraction and data completeness analytics
- Multiple export formats (JSON, CSV, BibTeX)

The purpose is not to automatically write a literature review or replace researcher judgment. ReTrace reduces the repetitive collection and organization work so the researcher can spend more time interpreting the evidence.

---

## 4. Frontend Workspace

The project includes a dedicated **React + Vite** frontend workspace that presents the backend analytics as a research-operating environment.

### Frontend architecture

- React 18 bootstrapped with Vite
- Client-side routing via React Router
- Live dashboard data fetched from the backend API via `useDashboardData` hook
- Dense dark research-instrument styling with provenance, signal, relationship, and source-health emphasis
- Reusable component library: `MetricCard`, `StatusBadge`, `EmptyState`, `ErrorBoundary`, `ArtifactDetailDrawer`, `RelationshipGraph`

### Runtime data flow

```text
backend Express API (/api/dashboard)
       ↓
frontend/src/hooks/useDashboardData.js
       ↓
React routes and page components
       ↓
Overview / artifacts / relationships / signals / analytics / review / sources
```

### Pages and routes

| Route | Page | Description |
|---|---|---|
| `/` | Overview | Dashboard with metrics, recent signals, top relationships, pulse counters |
| `/landscape` | Research Landscape | SVG-based visual relationship graph |
| `/artifacts` | Artifact Explorer | Searchable table with type filtering, pagination, JSON/CSV/BibTeX export |
| `/relationships` | Relationships | Evidence-backed candidate links with confidence bars |
| `/signals` | Signals | Research signals (NEW/UPDATED/REMOVED) with type filtering and grouping |
| `/history` | Change History | Chronological observation timeline |
| `/sources` | Sources | Source registry with health status and manual collection triggering |
| `/analytics` | Analytics | Keyword cloud, type distribution bars, data completeness metrics |
| `/literature` | Literature Matrix | Paper review workspace with change status and attention scoring |
| `/review` | Review Queue | Attention-scored artifact queue with dismiss/reviewed actions |
| `/self-healing` | Self-Healing | Source health summary and Bright Data repair workflow display |

### UI capabilities

- Dark research-workstation shell with persistent sidebar navigation and top bar
- Metric panels for research inventory and signal activity
- Relationship explorer built from actual relationship data (SVG graph)
- Artifact explorer table using real exported artifacts with server-side search and pagination
- Sources page with data-freshness, health semantics, and one-click collection triggering
- Analytics workspace with keyword extraction, type distribution, and data completeness
- Evidence-first signal and review workflow
- Artifact detail drawer with tabs (Overview, Versions, Relationships, Notes)
- Toast notification system for user feedback
- React ErrorBoundary for graceful error recovery
- Static snapshot messaging to avoid claiming real-time updates when the data is export-driven

### Deployment

The frontend is deployed to **GitHub Pages** via a GitHub Actions workflow on every push to `main`. The workflow installs dependencies, builds the Vite production bundle, and uploads to GitHub Pages.

### Important limitation

The frontend consumes the current backend API when running against the live service and may also render a generated snapshot export depending on the deployment mode. The project explicitly distinguishes between current backend state and generated snapshot data so the UI does not imply real-time behavior when the data is export-driven or historical.

---

## 5. API Reference

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |

### Sources

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sources` | List all sources with computed health status |

### Collections

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/collections` | List collections (filterable by `sourceName`, `limit`) |
| `POST` | `/api/collect/:sourceName` | Trigger collection for a specific source |

### Artifacts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/artifacts` | Search, filter, and paginate artifacts (`search`, `type`, `source`, `sort`, `page`, `limit`) |
| `GET` | `/api/artifacts/:id` | Get single artifact with versions and relationships |
| `PATCH` | `/api/artifacts/:id` | Update notes, mark as reviewed or dismissed |

### Changes & Signals

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/changes` | List research signals with optional `type` and `sourceName` filters |

### Dashboard

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Complete dashboard payload (sources, artifacts, relationships, signals, analytics, overview) |

### Export

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/export?format=json` | Export all artifacts as JSON |
| `GET` | `/api/export?format=csv` | Export all artifacts as CSV |
| `GET` | `/api/export?format=bibtex` | Export paper artifacts as BibTeX entries |

---

## 6. Data Sources

Four sources are currently configured in `sources.config.js`:

| Source | Collector Type | Artifact Type | Description |
|---|---|---|---|
| **arXiv** | Bright Data scraper | PAPER | Academic paper discovery and metadata collection |
| **GitHub** | Bright Data scraper | IMPLEMENTATION | Public implementation repositories and code resources |
| **duke-calderbank** | Bright Data scraper | PAPER | Faculty publication page (long-tail academic source, 84 topic-filtered records) |
| **fixture** | Bright Data scraper | PAPER | Deterministic test fixture for source-health and self-healing validation |

Each source defines a URL template, collector ID, artifact types, and expected record shape. The `resolveSourceInput()` function resolves the `{topic}` placeholder into the exact Bright Data trigger input.

---

## 7. Architecture

```text
                          RESEARCH SPACE
                    "OTFS channel estimation"
                              │
                              ▼
                     Source Configuration
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
            arXiv            GitHub      Duke-Calderbank
              │                │                │
              ▼                ▼                ▼
        Bright Data      Bright Data       Bright Data
        Collector ID     Collector ID      Collector ID
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                          Raw JSON Store
                          (backend/raw/)
                               │
                               ▼
                           Normalizer
                        (source-specific)
                               │
                               ▼
                       Artifact + Version
                               │
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
               Relationships  Signals  Analytics
                     │         │         │
                     └─────────┼─────────┘
                               ▼
                      Express API Server
                               │
                     ┌─────────┼─────────┐
                     ▼                   ▼
               React Frontend    GitHub Pages
              (Vite dev server)   (production)
```

### Database model (7 models)

```text
ResearchSpace
    │
    ├── Source
    │     └── Collection
    │           └── ArtifactVersion
    │
    ├── Artifact
    │     ├── ArtifactVersion (via collection)
    │     ├── Relationship (from)
    │     └── Relationship (to)
    │
    └── ResearchSignal

Artifact ── Relationship ── Artifact
```

| Model | Purpose |
|---|---|
| **ResearchSpace** | Top-level container for a research topic |
| **Source** | Data source configuration (name, collectorId, baseUrl, artifactTypes, status) |
| **Collection** | Individual collection run (status, recordCount, rawFilePath) |
| **Artifact** | Core research artifact (type, title, url, metadata, notes, reviewedAt) |
| **ArtifactVersion** | Versioned snapshot with content hash for change detection |
| **Relationship** | Evidence-backed link between two artifacts (type, confidence, evidence) |
| **ResearchSignal** | Detected change (type, severity, evidence) |

SQLite is used as the database engine. Fields that would naturally be enums are plain String columns with allowed values documented in schema comments and validated at the application layer.

### Pipeline flow

```text
Trigger (manual / scheduled / API)
    ↓
Bright Data API → raw JSON response
    ↓
Store raw file (backend/raw/<collectionId>.json)
    ↓
Run pipeline:
    ├── Normalize records → upsert Artifacts
    ├── Create ArtifactVersion with content hash
    ├── Compare with previous collection → detect changes
    ├── Generate ResearchSignals (NEW / UPDATED / REMOVED)
    └── Match paper ↔ repository → create Relationships
    ↓
Update Source health status
```

### Design principles

- **Public evidence only:** ReTrace works with publicly accessible research information. It does not require login-walled or private content.
- **Preserve evidence:** Raw source responses are retained, and relationship matches expose their supporting evidence.
- **Researcher remains in the loop:** ReTrace surfaces patterns and candidate relationships. It does not claim to automatically produce scientific conclusions.
- **Resilience is part of collection:** A web-data pipeline that silently returns empty fields after a source redesign is not healthy merely because the HTTP request succeeded. Source health and extraction validity matter.
- **Small, explainable building blocks:** The pipeline uses deterministic normalization and matching instead of hiding important decisions behind an opaque model. No LLM dependency.

---

## 8. Scheduler

ReTrace includes an optional recurring collection scheduler for automated periodic scans.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `RETRACE_SCHEDULE_ENABLED` | `false` | Enable/disable the scheduler |
| `RETRACE_SCHEDULE_INTERVAL_MS` | `60000` | Interval between scans in milliseconds |
| `RETRACE_SCHEDULE_SOURCES` | *(all sources)* | Comma-separated list of source names to scan |

When enabled, the scheduler triggers the full collection pipeline (collect → normalize → version → compare → signals → match) on each tick for all configured sources.

---

## 9. Current Evidence / Actual Results

The database is populated with real collected data for the active **OTFS channel estimation** Research Space.

**Updated: October 2026 — post-filter, second arXiv collection**

| Metric | Count |
|---|---:|
| Papers | **256** |
| Implementations | **10** |
| Total Artifacts | **266** |
| Candidate Paper → Repository Relationships | **28** |
| ResearchSignals (from second arXiv scan) | **172** |
| ArtifactVersions | **430** |

Sources:

| Source | Records | Status |
|---|---:|---|
| arXiv | 172 | HEALTHY |
| GitHub | 10 | HEALTHY |
| duke-calderbank | 84 | HEALTHY |
| fixture | 0 | TEST SOURCE |

> **Note on duke-calderbank count:** The original ingestion collected Prof. Calderbank's entire 481-paper career history. A topic-relevance filter (`topicFilter.js`) now keeps only artifacts whose title/description contains OTFS/wireless-domain keywords, reducing this to 84 on-topic papers. The filter applies at ingestion time for all future collections. The reduction is a data quality improvement, not a data loss.

### Signal examples from second arXiv scan (Oct 2026)

8 genuinely new OTFS papers appeared since the August 2026 baseline:

```text
NEW [PAPER] "Data-Aided Bayesian Learning for CSI Estimation over Doubly-Selective DCO-OTFS MIMO VLC Channels"
NEW [PAPER] "Dual-Orthogonality Waveforms for Integrated Communication and Imaging in Dynamic Multipath Channels"
NEW [PAPER] "A Deep Iterative Refinement Receiver for OTFS Symbol Detection in Doubly-Dispersive Channels"
NEW [PAPER] "Joint Channel Estimation, Detection, and Resource Allocation for OTFS-RSMA"
```

### Relevant matching examples

The strongest current candidate relationships resolved by the matching engine include:

```text
Channel Estimation and Equalization for CP-OFDM-based OTFS in Fractional Doppler Channels
    ↕
otfs-chan-est-and-eq

Embedded Pilot-Aided Channel Estimation for OTFS in Delay-Doppler Channels
    ↕
EP_Channel_Estimation_OTFS

Compressed Sensing Channel Estimation for OTFS Modulation in Non-Integer Delay-Doppler Domain
    ↕
Compressed_Sensing_OTFS_Channel_Estimation
```

The relationship layer is **implemented and backed by real data**, not a placeholder UI.

---

## 10. Self-Healing: What Was Actually Validated

Self-healing is deliberately part of the ReTrace architecture because the research sources themselves are web pages whose structure can change.

A controlled fixture was built specifically for deterministic testing:

```text
github.com/saad0O5/ReTrace-Fixture
```

The fixture's HTML structure was deliberately changed so the original selectors no longer matched the target fields.

The observed behavior: the collector could still complete at the API level while returning empty extracted fields. This demonstrated why source-health monitoring cannot rely only on HTTP success.

Bright Data's dashboard self-healing workflow was then used to:

1. detect the extraction mismatch,
2. generate a selector diff,
3. produce selectors matching the restructured page, and
4. verify the repaired extraction in live preview.

What is confirmed:

```text
Real structural break
        ↓
Extraction failure
        ↓
Bright Data self-healing analysis
        ↓
Correct regenerated selectors
        ↓
Live preview verifies recovered extraction
```

> **Honesty Regarding Production Promotion:**
> During testing, the final **Accept changes / production publish** step failed with `"Could not connect to preview server"`.
> Repeated attempts did not produce a new production collector version. The CLI `heal`/`approve` flow also reported success without producing the expected new production version.
> Therefore, ReTrace **does not claim that production promotion was successfully demonstrated**. Complete automated production self-healing was not demonstrated due to this platform-side issue.

---

## 11. Test Suite

ReTrace includes a comprehensive test suite with **82 tests** across 6 test phases:

| Suite | Tests | Coverage |
|---|---:|---|
| **Phase 0** | 27 | URL normalization, provenance, artifact versioning, source health, database integrity |
| **Phase 1** | 10 | Change detection (NEW/UPDATED/REMOVED), idempotent signals, failed-collection safety |
| **Phase 2** | 10 | Duke long-tail source normalizer, snapshot determinism, cross-source isolation |
| **Phase 3** | 14 | Analytics (keywords, coverage, completeness, attention scoring, timeline, research gaps) |
| **Phase 4** | 10 | Artifact type system, dataset/resource/project normalizers, backward compatibility |
| **Pipeline** | 11 | Similarity scoring, pipeline orchestration, artifact notes and review |

Run all tests:

```bash
cd backend
node tests/runAll.js
```

---

## 12. Technology Stack

### Collection

- Bright Data Scraper Studio
- Bright Data Collector IDs (per-source, versioned)
- Bright Data Data Collection API (`/dca/trigger`, `/dca/dataset`)
- Bright Data AI self-healing API (`/dca/collectors/{id}/refactor_template`)

### Backend

- **Runtime:** Node.js (CommonJS)
- **Framework:** Express 4
- **ORM:** Prisma 5
- **Database:** SQLite
- **Testing:** Custom test framework (82 tests across 6 suites)

### Frontend

- **Framework:** React 18.3
- **Build tool:** Vite 5
- **Routing:** React Router 6
- **Deployment:** GitHub Pages (via GitHub Actions)

### Data processing

- JavaScript normalization pipeline (source-specific normalizers)
- Deterministic artifact matching (no LLM dependency)
- Versioned artifact storage with SHA-256 content hashing
- Source-specific normalizers: arXiv, GitHub, Duke-Calderbank, dataset, resource, project
- URL normalization with tracking parameter stripping (`utm_*`, `fbclid`, `gclid`, `trk`, `_ga`, `ref`)
- Deterministic similarity scoring (keyword overlap, author overlap, domain affinity)

### Infrastructure

- Docker / Docker Compose (single-container deployment with volume persistence)
- GitHub Actions CI/CD for frontend deployment
- Named Docker volumes for database and raw data persistence

---

## 13. Repository Structure

```text
ReTrace/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma            # 7-model database schema
│   │   └── dev.db                   # SQLite database
│   ├── src/
│   │   ├── analysis/
│   │   │   ├── changeDetector.js    # Artifact set comparison (NEW/UPDATED/REMOVED)
│   │   │   ├── researchAnalytics.js # Keywords, timeline, completeness, attention queue
│   │   │   └── signalService.js     # Research signal generation and retrieval
│   │   ├── artifacts/
│   │   │   └── artifactTypes.js     # Supported artifact type definitions
│   │   ├── collectors/
│   │   │   ├── brightdata.js        # Bright Data API wrapper (trigger, poll, heal)
│   │   │   └── sources.config.js    # Source definitions (arxiv, github, duke-calderbank, fixture)
│   │   ├── database/
│   │   │   ├── client.js            # Prisma client initialization
│   │   │   ├── sourceHealth.js      # Dynamic source health computation
│   │   │   └── restoreAuditedBaseline.js  # Baseline restoration utility
│   │   ├── ingestion/
│   │   │   ├── normalizer.js        # Source-specific record normalizers
│   │   │   ├── urlNormalizer.js     # Deterministic URL normalization
│   │   │   └── snapshot.js          # Snapshot payload and content hash
│   │   ├── matching/
│   │   │   ├── resolver.js          # Paper-repository matching orchestration
│   │   │   └── similarity.js        # Deterministic similarity scoring
│   │   ├── services/
│   │   │   └── pipelineService.js   # Full pipeline orchestration
│   │   ├── scheduler.js             # Recurring collection scheduler
│   │   └── server.js                # Express server with all API routes
│   ├── raw/                         # Raw collection JSON files
│   └── tests/
│       ├── phase0.test.js           # URL normalization, provenance, versioning (27 tests)
│       ├── phase1.test.js           # Change detection and signals (10 tests)
│       ├── phase2.test.js           # Duke long-tail source (10 tests)
│       ├── phase3.test.js           # Analytics (14 tests)
│       ├── phase4.test.js           # Artifact type system (10 tests)
│       ├── pipeline.test.js         # Similarity scoring and pipeline (11 tests)
│       ├── scheduler.test.js        # Scheduler configuration (standalone)
│       └── runAll.js                # Test runner (82 tests across 6 suites)
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/
│   │   │   │   ├── EmptyState.jsx
│   │   │   │   ├── ErrorBoundary.jsx
│   │   │   │   ├── MetricCard.jsx
│   │   │   │   └── StatusBadge.jsx
│   │   │   ├── layout/
│   │   │   │   └── ArtifactDetailDrawer.jsx
│   │   │   └── relationships/
│   │   │       └── RelationshipGraph.jsx
│   │   ├── hooks/
│   │   │   └── useDashboardData.js
│   │   ├── utils/
│   │   │   └── formatters.js
│   │   ├── App.jsx                  # Main app with 11 page components
│   │   ├── main.jsx                 # React entry point
│   │   └── styles.css               # Dark research-workstation theme
│   ├── index.html
│   ├── dashboard-data.js            # Exported snapshot for static mode
│   ├── vite.config.js
│   └── package.json
│
├── scripts/
│   ├── backfillMissingDates.js      # Infer publication dates from arXiv IDs
│   ├── dbAudit.js                   # Database audit (counts, gaps, duplicates)
│   ├── detectChanges.js             # CLI change detection
│   ├── exportDashboard.js           # Export DB to frontend/dashboard-data.js
│   ├── ingestRaw.js                 # Ingest raw collection files
│   ├── matchRepos.js                # Run paper-repository matching
│   └── testCollector.js             # Standalone Bright Data collector test
│
├── scratch/
│   └── createDukeCollector.js       # One-off Bright Data collector creation helper
│
├── docs/
│   ├── architecture.md
│   ├── data-integrity-verification.md
│   ├── deployment-readiness.md
│   └── Known Limit.md
│
├── .github/
│   └── workflows/
│       └── deploy-pages.yml         # GitHub Pages deployment
│
├── .env.example
├── .gitignore
├── dbcheck.js                       # Quick database count/audit CLI utility
├── Dockerfile                       # Optional containerization
├── docker-compose.yml
├── package.json                     # Root scripts
└── README.md
```

---

## 14. Running ReTrace

### Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Configure environment

Copy the example configuration and provide the Bright Data credentials and collector IDs:

```bash
cp backend/.env.example backend/.env
```

Required environment variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite connection string (default: `file:./dev.db`) |
| `BRIGHTDATA_API_TOKEN` | Bright Data API authentication token |
| `BRIGHTDATA_ARXIV_COLLECTOR_ID` | Collector ID for arXiv source |
| `BRIGHTDATA_GITHUB_COLLECTOR_ID` | Collector ID for GitHub source |
| `BRIGHTDATA_DUKE_CALDERBANK_COLLECTOR_ID` | Collector ID for Duke-Calderbank source |
| `BRIGHTDATA_FIXTURE_COLLECTOR_ID` | Collector ID for test fixture |
| `PORT` | Server port (default: `5000`) |
| `NODE_ENV` | Environment mode (`development` / `production`) |
| `RETRACE_SPACE_NAME` | Research space name (default: `OTFS Channel Estimation`) |
| `RETRACE_TOPIC` | Research topic for query resolution (default: `OTFS channel estimation`) |
| `RETRACE_SCHEDULE_ENABLED` | Enable recurring scheduler (`false`) |
| `RETRACE_SCHEDULE_INTERVAL_MS` | Scheduler interval in ms (`60000`) |
| `RETRACE_SCHEDULE_SOURCES` | Comma-separated source names for scheduler (default: all) |

Do not commit `.env` or API keys.

### Initialize database

```bash
cd backend
npx prisma generate
npx prisma db push
```

### Run the backend

```bash
cd backend
node src/server.js
```

The server automatically seeds the research space and configured sources on startup. It listens on port 5000 by default (configurable via `PORT` environment variable).

Alternatively, use npm scripts from the `backend/` directory:

```bash
# Development with auto-reload (nodemon)
npm run dev

# Generate Prisma client after schema changes
npm run prisma:generate

# Push schema changes to database
npm run prisma:push

# Open Prisma Studio (database GUI)
npm run prisma:studio

# Run all tests
npm test
```

### Run the frontend (development)

```bash
cd frontend
npx vite
```

The Vite dev server runs on port 5173 and proxies `/api` requests to the backend on port 5000.

### Build for production

```bash
cd frontend
npx vite build
```

The production build is output to `frontend/dist/`. The Vite preview server can be started with `npx vite preview`.

### Run tests

```bash
cd backend
node tests/runAll.js
```

### CLI scripts

```bash
# Ingest raw collection data
node scripts/ingestRaw.js backend/raw/<raw-file>.json

# Match papers to repositories
node scripts/matchRepos.js

# Detect changes between collections
node scripts/detectChanges.js

# Export dashboard snapshot to frontend/dashboard-data.js
node scripts/exportDashboard.js

# Audit database integrity (counts, gaps, duplicates)
node scripts/dbAudit.js

# Backfill missing publication dates from arXiv IDs
node scripts/backfillMissingDates.js

# Quick database count/audit check
node dbcheck.js

# Standalone Bright Data collector test
node scripts/testCollector.js <sourceName>
```

### Root-level scripts

```bash
# Run backend in dev mode (from root)
npm run dev

# Run backend tests (from root)
npm test

# Detect changes between collections
npm run detect:changes

# Export dashboard snapshot
npm run export:dashboard
```

### Docker

```bash
# Build and run in a single container
docker compose up --build

# Open http://localhost:5000
```

The Docker setup builds both backend and frontend in one container, exposes port 5000, and uses named volumes (`retrace-data`, `retrace-raw`) for database and raw data persistence.

Alternatively, build and run the Docker image directly:

```bash
docker build -t retrace .
docker run -p 5000:5000 retrace
```

### GitHub Pages deployment

The frontend is automatically deployed to GitHub Pages on every push to `main` via the workflow in `.github/workflows/deploy-pages.yml`. The workflow:

1. Checks out the repository
2. Sets up Node.js 20 with npm caching
3. Installs and builds the frontend (`npm ci && npm run build`)
4. Uploads the `frontend/dist/` directory to GitHub Pages

Manual deployment can also be triggered from the Actions tab (`workflow_dispatch`).

---

## 15. Why ReTrace Is More Than a Scraper

A scraper answers:

> **"What is on this page?"**

ReTrace is intended to answer:

> **"What exists in this research space, how are the pieces connected, and what should I look at next?"**

The pipeline therefore has three distinct layers:

```text
COLLECT
public web → raw observations

CONNECT
observations → normalized artifacts → relationships

UNDERSTAND
artifacts + relationships + signals → research landscape
```

Bright Data is central to the first layer and to the resilience of the collection layer. The rest of ReTrace turns those observations into a domain-specific research tool.

---

## 16. Current Scope vs Future Scope

### Implemented

- [x] Bright Data Scraper Studio integration
- [x] Collector IDs and real trigger/poll workflow
- [x] arXiv collection (172 papers, 2 consecutive live scans)
- [x] GitHub collection (10 implementations)
- [x] Duke-Calderbank long-tail academic source (84 topic-filtered papers, topicFilter.js applied)
- [x] Controlled fixture for self-healing validation
- [x] Raw-first storage with provenance chain
- [x] Source-specific normalization (arXiv, GitHub, Duke-Calderbank, dataset, resource, project)
- [x] URL normalization (tracking params, fragments, casing, ports, .git suffixes)
- [x] Deduplication via deterministic URL identity
- [x] Artifact version storage with SHA-256 content hashing (430 versions)
- [x] Research change detection (NEW, UPDATED, REMOVED)
- [x] Idempotent ResearchSignals with provenance and relationship enrichment (172 active signals)
- [x] Failed-collection safety (preserves baseline, no false alerts)
- [x] Paper ↔ repository candidate matching with evidence (28 relationships)
- [x] Relationship confidence scoring, evidence transparency, and confidence threshold filter
- [x] Single-origin deployment (Express serves static React SPA from frontend/dist and /api/*)
- [x] Scheduled weekly collection via GitHub Actions (.github/workflows/scheduled-collection.yml)
- [x] 6 artifact types in schema and normalizer (PAPER, IMPLEMENTATION, DATASET, BENCHMARK, PROJECT, RESOURCE)
- [x] Research analytics (keywords, coverage, completeness, attention queue, timeline, research gaps)
- [x] React + Vite frontend with 11 workspace pages
- [x] Artifact detail drawer with versions, relationships, and notes tabs
- [x] SVG relationship graph visualization
- [x] Artifact notes and review/dismiss workflow
- [x] JSON, CSV, and BibTeX export
- [x] Scheduled recurring collections
- [x] Dynamic source health monitoring
- [x] 82 passing tests across 6 test suites
- [x] GitHub Pages deployment
- [x] Docker / Docker Compose support
- [x] Controlled self-healing validation

### Designed for the next iteration

- [ ] DATASET, BENCHMARK, PROJECT, RESOURCE populated from additional live sources
- [ ] Richer long-term trend analysis
- [ ] User-selectable research topics
- [ ] User-selected/custom public sources
- [ ] Automated notifications (Slack/Discord/email)
- [ ] Additional relationship types
- [ ] WebSocket-based live updates in frontend
- [ ] Production self-healing promotion (blocked by Bright Data platform issue)

---

## 17. Limitations / Known Constraints

- **Self-Healing Promotion Limitation:** The final Accept changes / production publish step failed during testing with `"Could not connect to preview server"`. While the CLI reported success and the dashboard generated/verified repaired selectors in live preview, those changes could not be promoted to production. See [docs/Known Limit.md](docs/Known%20Limit.md) for logs and full details.
- **Current Source Limitations:** The ingestion layer currently populates **PAPER** and **IMPLEMENTATION** artifacts from live sources. Extensible support for DATASET, BENCHMARK, PROJECT, and RESOURCE is designed in the schema and normalizer but not populated from live sources.
- **Deterministic Match Scoring:** The relationship resolution relies on deterministic keyword/title similarity scoring rather than external ground truth. Links are stored and presented strictly as candidate relationships.
- **Frontend data freshness:** The React dashboard fetches the current backend snapshot from `/api/dashboard` when it loads. It does not provide WebSocket updates for ongoing ingests; refresh the page after a collection completes.
- **GitHub collector pagination:** The current GitHub collector returns only the first page of results (10 records). This is a documented Bright Data collector limitation, not a bug.

---

## 18. Hackathon Positioning

ReTrace maps directly to the core judging criteria of the **Into the Scrape-Verse** hackathon:

- **Long-tail web data:** The architecture is designed for heterogeneous public research sources (which often lack structured APIs) rather than relying on standard pre-built scrapers.
- **Terminal-first workflow:** All collection triggers, ingestion, matching, and data exports are driven through the command-line interface and Collector IDs.
- **Code ownership and self-healing:** The project maintains full code-level configurations of sources and collectors, and explicitly tests and validates the Bright Data repair workflow under breaking changes.
- **Collector ID as production interface:** Collector IDs are treated as a stable, versioned boundary separating data collection from downstream ingestion and matching.
- **Public data focus:** The project consumes only publicly accessible research artifacts and does not attempt to bypass login walls or scrape private data.

---

## License

Created and Owned by Saad Ahmed.
