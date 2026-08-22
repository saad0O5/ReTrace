# ReTrace — Full Implementation Pipeline

One continuous build path, in the order to actually write it. Checkpoints (🚩) mark points where what exists is honestly submittable — not a suggestion to stop, just a marker so you always know where you stand.

---

## Phase 1 — Prove raw collection

**Goal:** real structured JSON out of Bright Data, nothing else.

1. Create the arXiv collector in Scraper Studio: query template `{topic}`, extract `title, authors, abstract, published_at, url, arxiv_id`.
2. Create the GitHub collector: query template `{topic}`, extract `repo_name, owner, description, url, language, stars, last_updated`.
3. Run both manually with `bdata scraper run` for `topic = "OTFS channel estimation"`.
4. Store raw output untouched:
```
raw/
 ├── collection_{id}.json   # collection_id, topic_id, source_id, collector_id, timestamp, raw_data, status
```
Don't transform anything yet — inspect the actual shape of what comes back before designing the normalizer around assumptions.

**Stop and look at the real data before Phase 2.** This is the step most plans skip and regret.

---

## Phase 2 — Data model + database

**Schema (Prisma / SQLite):**
```
ResearchSpace   { id, name, topic, description, created_at }
Source          { id, research_space_id, name, url, collector_id, status, artifact_types, last_run }
Collection       { id, source_id, started_at, completed_at, status, record_count }
Artifact         { id, research_space_id, type, title, description, url, published_at,
                    updated_at, first_seen, last_seen, metadata }
ArtifactVersion  { id, artifact_id, collection_id, content_hash, metadata, observed_at }
Relationship     { id, source_artifact_id, target_artifact_id, relationship_type, confidence, evidence }
ResearchSignal   { id, research_space_id, type, title, description, severity, created_at, evidence }
```

**Base artifact shape (all types):**
```json
{
  "id": "...", "artifact_type": "paper",
  "title": "...", "description": "...",
  "authors": [], "organizations": [],
  "url": "...", "source": "...",
  "published_at": "...", "updated_at": "...",
  "topics": [], "tags": []
}
```
Type-specific fields on top: **Paper** — venue, identifier. **Implementation** — repository, owner, language, stars, last updated. **Dataset** — version, size, license, access URL. **Benchmark** — task, dataset, metrics. **Project/Lab** — organization, research area, members. **Resource** — type, updated date.

**Backend module layout:**
```
backend/
 ├── collectors/    brightdata.js, collectorManager.js
 ├── ingestion/     normalizer.js, classifier.js, deduplicator.js
 ├── matching/      similarity.js, resolver.js
 ├── analysis/      changeDetector.js, trends.js, analytics.js, signals.js
 ├── database/      schema, repositories
 ├── api/           researchSpaces.js, sources.js, collections.js, artifacts.js, analytics.js
 └── server.js
```

At the end of Phase 2 you have raw JSON flowing into normalized `Artifact` rows in SQLite.

---

## Phase 3 — Artifact classification (all 6 types)

Deterministic rules first, no LLM dependency for the common cases:
```
arXiv result                → paper
GitHub repo with source     → implementation
dataset repository page     → dataset
benchmark/leaderboard page  → benchmark
research group/lab page     → project
documentation/tutorial page → resource
```
Route each source's raw output through the matching classifier function based on which collector it came from + light content sniffing. Fall back to an LLM call only for genuinely ambiguous pages — don't make classification depend on it by default.

🚩 **Checkpoint A — technically submittable floor:** raw collection (Phase 1) + normalized artifacts (Phase 2) + classification (Phase 3) already demonstrates real Scraper Studio usage and structured output. Not a good submission on its own, but if something catastrophic happens later, this state isn't nothing.

---

## Phase 4 — Deduplication

Matching hierarchy, strongest identifier first:
```
DOI / arXiv ID  →  exact URL  →  normalized title  →  title + author similarity
```
Only fall through to fuzzy title+author matching when the stronger identifiers are unavailable — most arXiv/GitHub pairs won't need it.

---

## Phase 5 — Relationships (entity matching across sources)

This is the "more than a scraper" layer.

Relationship types:
```
Paper --IMPLEMENTED_BY--> Repository
Paper --USES--> Dataset
Paper --EVALUATED_ON--> Benchmark
Paper --PRODUCED_BY--> Lab/Project
Paper --REFERENCES--> Paper
Dataset --BENCHMARKED_BY--> Benchmark
```
Matching function inputs: title similarity + author/org overlap + keyword overlap + explicit URL/reference in either source. Output: a confidence score and the evidence behind it — **always show why**, never hide the reasoning behind a bare score, since an unexplained "0.91 confidence" is not trustworthy to you or to a judge.

---

## Phase 6 — Historical storage + change detection

Every collection run writes an `ArtifactVersion` snapshot (don't overwrite). Comparing two runs gives you:
```
new artifacts / removed artifacts / updated artifacts / new connections / changed metadata
```
Rendered as:
```
SINCE LAST SCAN
+6 papers   +3 repositories   +2 datasets   +1 benchmark
2 papers gained implementations
1 dataset received a new version
```

🚩 **Checkpoint B — solid submittable state:** classification + dedup + relationships + one real "since last scan" delta is a genuinely complete story: collection → structure → connection → change. This is the point where the core thesis of ReTrace is fully demonstrable even if analytics/UI are still rough.

---

## Phase 7 — Analytics (all 4 layers)

**A. Overview** — raw counts per artifact type.
**B. Trends** — activity over time per month; "emerging methods" as simple keyword-frequency deltas (label explicitly as *observed activity*, not a claim about the field).
**C. Relationships** — % of papers with public code, % linked to datasets, which datasets get reused across the most papers.
**D. Signals** — pattern-level observations, framed as *potential signals*, never definitive conclusions:
```
Potential signal: Only 3 of 27 recent papers provide public implementations.
This may indicate limited reproducibility in this segment.
```
The researcher draws the conclusion — the system surfaces the pattern.

---

## Phase 8 — Literature Review Mode

The matrix view: `Paper | Year | Data | Method | Task | Metrics | Code | Dataset`, filterable by year/method/data/code-availability, exportable to CSV. This is your direct personal payoff — it's a usable literature-review artifact you take out of the hackathon regardless of how judging goes.

---

## Phase 9 — Configurable sources + custom-source workflow

Source config object (already true by design since Phase 1, just now exposed):
```json
{ "name": "arxiv", "base_url": "...", "collector_id": "c_xxx",
  "artifact_types": ["paper"], "query_template": "{topic}" }
```
Custom-source UI flow:
```
User adds site → ReTrace generates extraction spec → Scraper Studio creates collector
→ test collection → user approves → collector_id stored → source joins the research space
```
This is what proves the architecture is genuinely general, not hardcoded to arXiv/GitHub — build it once the core pipeline (Phases 1–8) is solid, not before, since a custom-source builder on top of a shaky core just multiplies the surface area for something to break.

---

## Phase 10 — Self-healing (hero feature, not bolt-on)

```
Source runs normally → website changes → extraction fails
   ↓
Source: ⚠ Extraction issue    Last successful scan: [date]
   ↓
bdata scraper heal
   ↓
Source: ✓ Healthy    Same Collector ID    Records: N
```
Design one deliberately reproducible failure (controlled fixture, or a real target you've already seen shift once) so this is demonstrable on demand, not hoped-for. Wire source health status into the Sources view so this is visible in the UI, not just in a terminal log.

🚩 **Checkpoint C — full-strength submission:** everything above, self-heal demonstrated live or on video, on top of a working literature matrix and analytics layer. This is the version that hits all six rubric criteria at full depth.

---

## Phase 11 — Scheduling

Manual "Run scan" button is enough functionally; add a cron job calling `POST /dca/trigger` on a schedule once the manual path is reliable, so it actually runs unattended for your own ongoing use after the hackathon.

---

## API surface (build incrementally, roughly in this order)
```
POST /api/research-spaces
GET  /api/research-spaces/:id
POST /api/research-spaces/:id/sources
GET  /api/research-spaces/:id/sources
POST /api/sources/:id/collect
GET  /api/research-spaces/:id/artifacts
GET  /api/artifacts/:id
GET  /api/research-spaces/:id/analytics
GET  /api/research-spaces/:id/trends
GET  /api/research-spaces/:id/signals
GET  /api/research-spaces/:id/matrix
GET  /api/research-spaces/:id/export/csv
```

## UI views (build in this order — each is usable standalone as you add the next)
1. **Sources** — health status, collector IDs, this is also where the heal moment is visible
2. **Overview** — counts + "since last scan" delta
3. **Artifacts** — the raw connected list
4. **Literature Matrix** — filterable table + export
5. **Research Landscape** — topic → data/methods/tasks breakdown (derived from normalized metadata, no separate knowledge-graph engine needed for v1)

## Demo script (once Checkpoint C is reached)
```
1. Problem: research info scattered across paper / code / dataset / lab pages
2. Configure: topic = OTFS channel estimation, sources = arXiv + GitHub
3. Collect: show live Collector IDs
4. Transform: raw → 42 papers, 11 implementations, 4 datasets
5. Connect: paper ↔ repo ↔ dataset links, with evidence shown
6. Understand: trend signals (↑ neural methods, ↑ sparse estimation)
7. Literature matrix: structured comparison table
8. Change: re-run → "+6 papers, +2 implementations" since last scan
9. Break it: force a collector failure → bdata scraper heal → same Collector ID → recovered
```
Optional closer if time allows: re-run the same pipeline against a second topic (e.g. a genomics query, tying back to your FYP) to prove the architecture generalizes.

## Ready answers for likely questions
- **"Why not Google Scholar?"** — Google Scholar gives you papers. ReTrace gives you the evolving, connected research ecosystem around a topic — code, datasets, and what changed since you last looked.
- **"Why not a lit-review AI?"** — ReTrace doesn't replace judgment. It collects fragmented public evidence, connects it, tracks change, and organizes it — the researcher still draws the conclusions.
- **"Why Bright Data specifically?"** — The valuable sources here aren't standardized APIs. ReTrace lets sources be brought in as public web pages, with Bright Data handling extraction and self-healing when those pages change.

## Out of scope, genuinely (not a hackathon MVP concern — just not part of this product)
Full academic search engine, PDF-understanding platform, citation manager, automated literature-review writing, automated scientific conclusions, a Semantic-Scholar-scale citation graph, user auth/multi-tenancy, mobile app, 50+ source integrations.
