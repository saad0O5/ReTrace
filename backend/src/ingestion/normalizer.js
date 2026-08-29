// Converts a raw arXiv record (as actually returned by our arXiv collector)
// into the common Artifact shape shared across all sources.
//
// Real field names confirmed from a live 164-record pull (Aug 2026):
//   paper_title, authors[], abstract, url, arxiv_id, published_date
//
// Two things this MUST handle because they're real, not hypothetical:
//   1. published_date is ABSENT on a meaningful fraction of records (observed on
//      several of the reposted/updated papers, e.g. ones ending in "v2"/"v3").
//      Never assume it exists.
//   2. arxiv_id is a messy compound string: "2511.08504 arXiv:2511.08504v2"
//      — not a clean ID by itself. The URL is the reliable source of the ID.

const { normalizeUrl } = require("./urlNormalizer");

function parseArxivId(rawArxivId, url) {
  // Prefer the URL - it's clean and present on every record.
  const fromUrl = url && url.match(/\/abs\/([^/?#]+)/);
  if (fromUrl) return fromUrl[1];
  // Fallback: first token of the messy field.
  if (rawArxivId) return rawArxivId.split(" ")[0];
  return null;
}

function parseVersion(rawArxivId) {
  if (!rawArxivId) return null;
  const match = rawArxivId.match(/v(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function normalizeArxivRecord(raw) {
  const rawUrl = raw.url || null;
  const canonicalUrl = normalizeUrl(rawUrl);
  const arxivId = parseArxivId(raw.arxiv_id, canonicalUrl || rawUrl);

  return {
    type: "PAPER",
    title: raw.paper_title || "(untitled)",
    description: raw.abstract || null,
    url: canonicalUrl || rawUrl,
    source: "arxiv",
    // Deliberately nullable - do not default this to "now" or drop the record.
    // A missing published_date is real data about this record, not an error.
    publishedAt: raw.published_date ? new Date(raw.published_date) : null,
    metadata: JSON.stringify({
      authors: raw.authors || [],
      arxivId,
      rawArxivId: raw.arxiv_id || null,
      rawUrl,
      version: parseVersion(raw.arxiv_id),
    }),
  };
}

// Converts a raw GitHub record from Bright Data into the common Artifact shape
// (type: "IMPLEMENTATION").
//
// Built against REAL observed output from collector c_mt5yn9lvrgrgdp5vm
// (backend/raw/manual-github-1787499165338.json, 10 records) — the first GitHub
// collector (c_mt4p886y15pmyqfts) had a stale ".search-title" selector after a
// GitHub search-page redesign; it was diagnosed via DevTools inspection, and a
// fresh AI-generated scraper (`bdata scraper create`) was built against the
// current live page instead of hand-patching the old one.
//
// Confirmed quirks in the real output, not assumed:
//   - `description` is absent (no key at all) on 2 of 10 observed records.
//   - `url` is present on only 1 of 10 observed records. GitHub repo URLs follow
//     a deterministic /{owner}/{repo_name} pattern, confirmed against the one
//     record that DID include `url` — reconstructed for the rest rather than
//     left null.
//   - `language` and `last_updated` were requested in the scraper's extraction
//     prompt but never appeared in ANY observed record — treated as reliably
//     absent from this collector's output, not per-record missing data.
//   - `input.url` is the shared search query URL, identical across every record
//     in a run — not a per-repo identifier, discarded.
//   - Only 10 records returned (GitHub's default search page size). This
//     collector does not paginate past page 1 — documented limitation, not a bug.
function normalizeGithubRecord(raw) {
  if (!raw.repo_name || !raw.owner) {
    throw new Error(
      `normalizeGithubRecord: missing required field(s) on record: ${JSON.stringify(raw)}`
    );
  }

  const rawUrl = raw.url || null;
  const constructedUrl = raw.url || `https://github.com/${raw.owner}/${raw.repo_name}`;
  const canonicalUrl = normalizeUrl(constructedUrl);

  return {
    type: "IMPLEMENTATION",
    title: raw.repo_name,
    description: raw.description || null,
    url: canonicalUrl || constructedUrl,
    source: "github",
    // Neither field is returned by this collector — see header note. Left null
    // deliberately rather than guessed, same discipline as arXiv's publishedAt.
    publishedAt: null,
    updatedAt: null,
    metadata: JSON.stringify({
      owner: raw.owner,
      repository: canonicalUrl || constructedUrl,
      rawUrl,
      language: null,
      stars: typeof raw.stars === "number" ? raw.stars : null,
      lastUpdated: null,
    }),
  };
}

module.exports = { normalizeArxivRecord, normalizeGithubRecord, parseArxivId, normalizeUrl };