# ReTrace

**ReTrace turns fragmented public research-web data into a connected, traceable research landscape.**

Built for **Into the Scrape-Verse — WeMakeDevs × Bright Data** using Bright Data Scraper Studio and Collector IDs.

> **Research should not end at a pile of search results. ReTrace traces the artifacts, connections, and changes that make a research field understandable.**

> **The Core Idea:** ReTrace collects the fragmented public artifacts around a research topic, traces the relationships between them, and turns the result into a living research landscape that a researcher can actually use.

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
Relationships between artifacts
  ↓
Research landscape + literature-review views
```

For the current demonstration, the Research Space is:
> **OTFS channel estimation**

This is a real research topic from my wireless-communications research internship, not a synthetic dataset chosen only for the demo.

The current working sources are:
- **arXiv** — research papers
- **GitHub** — public implementation repositories
- **Controlled fixture** — used only to demonstrate Bright Data self-healing against a deliberate structural change

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
Different sources use different field names and structures. ReTrace converts them into a common artifact model.

The current model supports:
```text
PAPER
IMPLEMENTATION
DATASET
BENCHMARK
PROJECT
RESOURCE
```
The current live demonstration populates **PAPER** and **IMPLEMENTATION** artifacts.

### 3.4 Data hygiene, identity normalization, and version snapshots (Phase 0)
Artifacts are retained as persistent entities rather than treating every scrape as an isolated, duplicate record.

- **Identity & URL normalization:** A centralized, deterministic `normalizeUrl()` function normalizes whitespace, protocol/host casing, standard ports, URL fragments, and trailing slashes, while stripping harmless tracking parameters and sorting query parameters deterministically.
- **Provenance preservation:** Every artifact retains its original source URL in metadata and is strictly traceable through its relational chain: `Artifact` → `ArtifactVersion` → `Collection` → `Source` → `Bright Data Collector ID`.
- **Deterministic snapshotting:** Each observation computes a canonical snapshot payload and SHA-256 content hash. Identical re-observations only update `lastSeen` without polluting history with duplicate versions; genuine content changes create a new `ArtifactVersion` snapshot.
- **Dynamic source health:** Source status (`HEALTHY`, `CONFIGURED`, `EXTRACTION_FAILED`, `TEST SOURCE`) is derived from actual collection run history rather than hardcoded configuration.

### 3.5 Connect research artifacts
ReTrace currently implements:
```text
Paper ── IMPLEMENTED_BY ──> Repository
```
The matcher produces a confidence score **and the evidence behind that score** rather than presenting an unexplained probability.

Current matching evidence can include title/description similarity and keyword overlap.

The system currently stores **candidate relationships**, not claims of ground truth. A researcher can inspect the evidence before treating a connection as authoritative.

### 3.6 Analyze
The dashboard turns the collected artifacts into a research-oriented view:
- source health
- artifact counts
- paper/implementation coverage
- connected paper ↔ repository relationships
- confidence and matching evidence
- searchable literature matrix
- recent research activity
- self-healing status and validation notes

The purpose is not to automatically write a literature review or replace researcher judgment. ReTrace reduces the repetitive collection and organization work so the researcher can spend more time interpreting the evidence.

---

## 4. Current Evidence / Actual Results

The database is populated with real collected data for the active **OTFS channel estimation** Research Space. The metrics show:

- **164 papers** (collected from arXiv, normalized, and ingested)
- **10 implementations** (collected from GitHub, normalized, and ingested)
- **174 total artifacts**
- **19 paper-to-implementation relationships** (candidate links identified by the similarity resolver)

| Artifact Category | Count |
|---|---:|
| Papers | **164** |
| Implementations | **10** |
| Total Artifacts | **174** |
| Candidate Paper → Repository Relationships | **19** |

The current GitHub collector was regenerated after the original collector used a stale selector following a GitHub page-structure change. The regenerated collector is:
```text
c_mt5yn9lvrgrgdp5vm
```
It successfully returned **10 real repository records**, which were then normalized and ingested into the database.

### Relevant Matching Examples
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
The relationship layer is therefore **implemented and backed by real data**, not a placeholder UI.

---

## 5. Self-Healing: What Was Actually Validated

Self-healing is deliberately part of the ReTrace architecture because the research sources themselves are web pages whose structure can change.

We built a controlled fixture specifically for deterministic testing:
```text
github.com/saad0O5/ReTrace-Fixture
```
The fixture's HTML structure was deliberately changed so the original selectors no longer matched the target fields.

The observed behavior was important: the collector could still complete at the API level while returning empty extracted fields. This demonstrated why source-health monitoring cannot rely only on HTTP success.

Bright Data's dashboard self-healing workflow was then used to:
1. detect the extraction mismatch,
2. generate a selector diff,
3. produce selectors matching the restructured page, and
4. verify the repaired extraction in live preview.

What is confirmed is:
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

> [!IMPORTANT]
> **Honesty Regarding Production Promotion:**
> During testing, the final **Accept changes / production publish** step failed with `"Could not connect to preview server"`. 
> Repeated attempts did not produce a new production collector version. The CLI `heal`/`approve` flow also reported success without producing the expected new production version.
> Therefore, ReTrace **does not claim that production promotion was successfully demonstrated**. We do not claim complete automated production self-healing due to this platform-side issue.

---

## 6. Architecture

```text
                          RESEARCH SPACE
                    "OTFS channel estimation"
                              │
                              ▼
                     Source Configuration
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
            arXiv            GitHub          Fixture
              │                │                │
              ▼                ▼                ▼
        Bright Data      Bright Data       Bright Data
        Collector ID     Collector ID      Collector ID
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                          Raw JSON Store
                               │
                               ▼
                           Normalizer
                               │
                               ▼
                       Artifact + Version
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
                Relationships        Analytics
                     │                   │
                     └─────────┬─────────┘
                               ▼
                          ReTrace UI
```

### Database model
```text
ResearchSpace
    │
    ├── Source
    │     └── Collection
    │
    ├── Artifact
    │     └── ArtifactVersion
    │
    └── ResearchSignal

Artifact ── Relationship ── Artifact
```
The design intentionally separates collection from interpretation. Raw data can be retained and reprocessed independently from the source collector.

### Design Principles
- **Public evidence only:** ReTrace works with publicly accessible research information. It does not require login-walled or private content.
- **Preserve evidence:** Raw source responses are retained, and relationship matches expose their supporting evidence.
- **Researcher remains in the loop:** ReTrace surfaces patterns and candidate relationships. It does not claim to automatically produce scientific conclusions.
- **Resilience is part of collection:** A web-data pipeline that silently returns empty fields after a source redesign is not healthy merely because the HTTP request succeeded. Source health and extraction validity matter.
- **Small, explainable building blocks:** The current MVP deliberately uses deterministic normalization and matching instead of hiding important decisions behind an opaque model.

---

## 7. Technology Stack

### Collection
- Bright Data Scraper Studio
- Bright Data Collector IDs
- Bright Data Data Collection API

### Backend
- Node.js
- Express
- Prisma
- SQLite

### Data processing
- JavaScript normalization pipeline
- deterministic artifact matching
- versioned artifact storage

### Frontend
- HTML
- CSS
- vanilla JavaScript
- exported database snapshot (`dashboard-data.js`)

No React build is required for the current demo. The dashboard is intentionally a lightweight static artifact that can be opened directly in a browser.

---

## 8. Repository Structure

```text
ReTrace/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── collectors/
│   │   │   ├── brightdata.js
│   │   │   └── sources.config.js
│   │   ├── database/
│   │   │   └── client.js
│   │   ├── ingestion/
│   │   │   └── normalizer.js
│   │   ├── matching/
│   │   │   ├── resolver.js
│   │   │   └── similarity.js
│   │   └── server.js
│   └── raw/
│
├── frontend/
│   ├── dashboard.html
│   └── dashboard-data.js
│
├── scripts/
│   ├── testCollector.js
│   ├── ingestRaw.js
│   ├── matchRepos.js
│   └── exportDashboard.js
│
├── docs/
│   ├── architecture.md
│   ├── checkpoint-a.md
│   └── Known Limit.md
│
├── .env.example
├── .gitignore
└── README.md
```

---

## 9. Running ReTrace

### Install backend dependencies
```bash
cd backend
npm install
```

### Configure environment
Copy the example configuration and provide the Bright Data credentials and collector IDs:
```bash
cp .env.example .env
```
Do not commit `.env` or API keys.

### Initialize Prisma
```bash
npx prisma generate
npx prisma db push
```

### Run the backend
```bash
npm run dev
```

### Collect a source
The collector wrapper supports triggering a configured Bright Data source and polling its snapshot.

### Ingest raw data
```bash
node scripts/ingestRaw.js backend/raw/<raw-file>.json
```

### Match papers to repositories
```bash
node scripts/matchRepos.js
```

### Export the dashboard snapshot
```bash
node scripts/exportDashboard.js
```

Then open:
```text
frontend/dashboard.html
```
The dashboard intentionally loads the exported snapshot directly, so no frontend build server is required.

---

## 10. Why ReTrace Is More Than a Scraper

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
artifacts + relationships → research landscape
```
Bright Data is central to the first layer and to the resilience of the collection layer. The rest of ReTrace turns those observations into a domain-specific research tool.

---

## 11. Current Scope vs Future Scope

### Implemented in the current submission
- [x] Bright Data Scraper Studio integration
- [x] Collector IDs and real trigger/poll workflow
- [x] arXiv collection
- [x] GitHub collection
- [x] raw-first storage
- [x] artifact normalization
- [x] deduplication
- [x] artifact version storage
- [x] paper ↔ repository candidate matching
- [x] relationship evidence and confidence
- [x] 174 real artifacts (164 papers, 10 implementations)
- [x] 19 candidate relationships
- [x] searchable literature matrix
- [x] research-oriented dashboard
- [x] controlled self-healing validation

### Designed for the next iteration
- [ ] datasets, benchmarks, projects and resources populated from additional sources
- [ ] historical "since last scan" deltas rendered in the dashboard
- [ ] richer research signals and trend analysis
- [ ] user-selectable research topics
- [ ] user-selected/custom public sources
- [ ] scheduled collection
- [ ] CSV export of the literature matrix
- [ ] additional relationship types

---

## 12. Limitations / Known Constraints

This section distinguishes active runtime/platform constraints from planned future capabilities:

* **Self-Healing Promotion Limitation:**
  The final **Accept changes / production publish** step failed during testing with `"Could not connect to preview server"`. While the CLI reported success and the dashboard generated/verified repaired selectors in live preview, those changes could not be promoted to production. See [`docs/Known Limit.md`](docs/Known%20Limit.md) for logs and full details.
* **Current Source Limitations:**
  The ingestion layer currently only extracts and links **PAPER** and **IMPLEMENTATION** artifacts from arXiv and GitHub. Extensible support for benchmarks, datasets, or other resource URLs is designed but not populated in the current database.
* **Deterministic Match Scoring:**
  The relationship resolution relies on deterministic keyword/title similarity scoring rather than external ground truth. Links are stored and presented strictly as candidate relationships.
* **Static Dashboard Feed:**
  The dashboard loads from the static file `dashboard-data.js` and does not support real-time websocket updates of ongoing ingests.

---

## 13. Hackathon Positioning

ReTrace maps directly to the core judging criteria of the **Into the Scrape-Verse** hackathon:

- **Long-tail web data:** The architecture is designed for heterogeneous public research sources (which often lack structured APIs) rather than relying on standard pre-built scrapers.
- **Terminal-first workflow:** All collection triggers, ingestion, matching, and data exports are driven through the command-line interface and Collector IDs.
- **Code ownership and self-healing:** The project maintains full code-level configurations of sources and collectors, and explicitly tests and validates the Bright Data repair workflow under breaking changes.
- **Collector ID as production interface:** Collector IDs are treated as a stable, versioned boundary separating data collection from downstream ingestion and matching.
- **Public data focus:** The project consumes only publicly accessible research artifacts and does not attempt to bypass login walls or scrape private data.

---

## License

Created and Owned by Saad Ahmed.
