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
  const arxivId = parseArxivId(raw.arxiv_id, raw.url);
  return {
    type: "PAPER",
    title: raw.paper_title || "(untitled)",
    description: raw.abstract || null,
    url: raw.url,
    source: "arxiv",
    // Deliberately nullable - do not default this to "now" or drop the record.
    // A missing published_date is real data about this record, not an error.
    publishedAt: raw.published_date ? new Date(raw.published_date) : null,
    metadata: JSON.stringify({
      authors: raw.authors || [],
      arxivId,
      rawArxivId: raw.arxiv_id || null,
      version: parseVersion(raw.arxiv_id),
    }),
  };
}

module.exports = { normalizeArxivRecord, parseArxivId };