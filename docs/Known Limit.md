## Known Platform Limitation: Self-Healing Publish Step

**Status:** Dashboard mechanism validated. CLI has a confirmed gap. Publish step has 
transient infra failures.

**Setup:** Built a controlled fixture (github.com/saad0O5/ReTrace-Fixture, served via 
GitHub Pages) specifically to test `bdata scraper heal` deterministically — original 
selectors broken by a deliberate page restructure.

**Findings:**
1. `bdata scraper heal` + `bdata scraper approve` (CLI) report success and walk through 
   what looks like a complete workflow, but do not create a new collector version. 
   Confirmed via the dashboard's Changelog tab — only the original AI-generated version 
   ever appears, regardless of how many times heal/approve are run.
2. The dashboard's own "Self-Healing" button works correctly: it generates a correct 
   diff (v1 → v2 selectors matching the restructured fixture) with a live preview 
   showing real extracted data.
3. The final "Accept changes" / publish step fails with `"Could not connect to preview 
   server"` — retried multiple times including a fresh regenerate, still failing. 
   Bright Data's own CLI docs reference AI-flow concurrent-job caps as a known failure 
   category, consistent with a transient infra issue rather than a logic error.

**Net result:** Self-healing detection and diffing is validated as working. Publish/
promotion to production could not be completed within the project timeline. Collector 
`c_mt5c4xao29ue6pvc89` remains on v1 selectors in production against the live v2 fixture 
page.

**For demo:** show the dashboard diff + live preview (this is the real, working part of 
the story) and state the publish-step limitation plainly rather than implying full 
end-to-end success.

---

## Remaining work and honest status

This file is intentionally the place where platform constraints and work left open are kept visible.

### Status of open items
 
1. Date-backfill verification — **COMPLETE**
   - The arXiv fallback-date inference code path is fully verified.
   - Live SQLite query confirms: 246 of 266 artifacts (92.5%) have valid `publishedAt`.
   - 100% of arXiv papers (172/172) have valid publication dates.
   - The only null publication dates are 10 Duke faculty publication records where no year was provided on the source page, and 10 GitHub repository artifacts where publication date is not applicable.

2. Bright Data production publish remains blocked (Platform constraint).
   - Detection and diffing work inside the platform preview loop.
   - Final accept/publish promotion still fails with the preview server connectivity error, so the project does not claim end-to-end self-healing production success.


3. Live source expansion beyond the current set remains future work.
   - Dataset / resource / project normalizers are implemented and tested.
   - They are not yet claimed as fully populated from live sources at scale.

4. Deployment-readiness work is still separate from the core pipeline validation.
   - The codebase is verified, but a production deployment handoff still requires environment, runtime, and operational checks.