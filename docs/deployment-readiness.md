# Deployment readiness checklist

This is the honest deployment checklist for the current ReTrace state. The core pipeline is already validated in tests and against the live DB, but deployment is still a separate operational handoff from the technical feature build.

## D1 — Environment and secrets

- [x] Confirm `.env` values are correct for the target environment.
- [x] Ensure `DATABASE_URL` points to the correct SQLite file (`file:./dev.db`).
- [x] Verify Bright Data tokens and collector IDs are valid (`arxiv`, `github`, `duke-calderbank`, `fixture`).
- [x] Set `RETRACE_SPACE_NAME`, `RETRACE_TOPIC`, and scheduler env vars explicitly in `docker-compose.yml` and `.github/workflows/scheduled-collection.yml`.

Status: Verified and operational.

## D2 — Runtime configuration and startup

- [x] Confirm `backend/src/server.js` starts with target env values.
- [x] Confirm single-origin static frontend serving (`frontend/dist` served at `/*` with SPA fallback; API at `/api/*`).
- [x] Confirm the research space and source seed rows are idempotent (`ensureSeeded()` verified).
- [x] Verify `/health` and `/api/dashboard` return valid payloads.

Status: Fully wired and tested in `server.js` and `Dockerfile`.

## D3 — Data integrity and change detection

- [x] Run real DB verification queries for counts (266 artifacts, 430 versions, 28 relationships, 172 signals).
- [x] Confirm topic relevance filter (`topicFilter.js`) is active at ingestion time.
- [x] Confirm delta detection operates against prior baseline: 2nd arXiv collection generated 172 real `ResearchSignal` records (8 NEW, 164 UPDATED).
- [x] Date completeness verified: 100% (172/172) arXiv papers have valid `publishedAt`. Only 10 Duke papers lack year on the source HTML and 10 GitHub repos lack published date by design.

Status: Validated against live database and full automated test suite (72/72 tests passing).

## D4 — Operational limits and user expectations

- [x] Document the Bright Data self-healing publish limitation clearly in `docs/Known Limit.md`.
- [x] Clarify that self-healing detection & diffing work in the platform preview loop, but production publish is platform-constrained.
- [x] Keep UI claims aligned to backend reality (static snapshot timestamp displayed, candidate matching evidence shown).

Status: Documented transparently.

## Bottom line

ReTrace is in a solid code-and-test-validated state, but it is not yet a fully production-claimed deployment without a clean host-specific runtime check and explicit acknowledgment of the Bright Data publish limitation.