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

function inferArxivDateFromId(arxivId) {
  if (!arxivId) return null;
  const match = String(arxivId).match(/^(\d{2})(\d{2})\.(\d{4,5})(?:v\d+)?$/i);
  if (!match) return null;
  const [, yearPrefix, monthPrefix] = match;
  const yy = Number(yearPrefix);
  const yearNumber = yy >= 90 ? 1900 + yy : 2000 + yy;
  if (!Number.isInteger(yearNumber) || yearNumber < 1990) return null;
  return new Date(Date.UTC(yearNumber, Number(monthPrefix) - 1, 1));
}

function normalizeArxivRecord(raw) {
  const rawUrl = raw.url || null;
  const canonicalUrl = normalizeUrl(rawUrl);
  const arxivId = parseArxivId(raw.arxiv_id, canonicalUrl || rawUrl);
  const publishedAt = raw.published_date
    ? new Date(raw.published_date)
    : inferArxivDateFromId(arxivId);

  return {
    type: "PAPER",
    title: raw.paper_title || "(untitled)",
    description: raw.abstract || null,
    url: canonicalUrl || rawUrl,
    source: "arxiv",
    // Use the real published date when the collector provides it; otherwise infer
    // it from the arXiv ID. This is a safe, deterministic fallback and avoids
    // dropping records simply because the source omitted `published_date`.
    publishedAt,
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

function normalizeCalderbankRecord(raw) {
  if (!raw || !raw.title) {
    throw new Error(`normalizeCalderbankRecord: missing required title field: ${JSON.stringify(raw)}`);
  }

  const sourcePageUrl = raw.product_page_url || raw.sourcePageUrl || raw.pageUrl || raw.input?.url || null;
  const publicationUrl = raw.publication_url || raw.publicationUrl || raw.url || raw.link || null;
  const rawUrl = raw.url || publicationUrl || sourcePageUrl || raw.sourcePageUrl || raw.product_page_url || raw.input?.url || null;
  const canonicalUrl = normalizeUrl(publicationUrl || rawUrl || sourcePageUrl || null);

  const authors = Array.isArray(raw.authors)
    ? raw.authors
        .map((a) => String(a || "").trim())
        .filter(Boolean)
    : typeof raw.authors === "string"
    ? raw.authors
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean)
    : [];

  const yearInput = raw.year || raw.publication_year || raw.date || raw.published_year || raw.publication_date || raw.publicationDate || null;
  const yearNumber = Number(String(yearInput || "").match(/\d{4}/)?.[0]);
  const publishedAt = yearNumber ? new Date(Date.UTC(yearNumber, 0, 1)) : null;

  return {
    type: "PAPER",
    title: String(raw.title).trim(),
    description: raw.description || raw.abstract || null,
    url: canonicalUrl || rawUrl || sourcePageUrl || null,
    source: "duke-calderbank",
    publishedAt,
    metadata: JSON.stringify({
      authors,
      year: yearNumber || null,
      venue: raw.venue || raw.journal || raw.conference || raw.publication_venue || raw.publicationVenue || null,
      doi: raw.doi || raw.DOI || null,
      rawUrl,
      sourcePageUrl: sourcePageUrl,
      publicationUrl,
      inputUrl: raw.input?.url || null,
      rawRecord: raw,
    }),
  };
}

function normalizeDatasetRecord(raw) {
  if (!raw || !raw.url) {
    throw new Error(`normalizeDatasetRecord: missing required URL field: ${JSON.stringify(raw)}`);
  }

  const rawUrl = raw.url || raw.homepage || raw.dataset_url || raw.download_url || null;
  const canonicalUrl = normalizeUrl(rawUrl);
  const title = raw.dataset_name || raw.name || raw.title || "(untitled dataset)";
  const metadata = {
    rawUrl,
    owner: raw.owner || raw.organization || null,
    organization: raw.organization || raw.owner || null,
    datasetName: raw.dataset_name || raw.name || null,
    size: raw.size || raw.dataset_size || raw.bytes || null,
    format: raw.format || raw.file_format || raw.dataset_format || null,
    license: raw.license || null,
    updatedAt: raw.updated_date || raw.updatedAt || null,
    homepage: raw.homepage || null,
    downloadUrl: raw.download_url || raw.downloadUrl || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    sourceMetadata: raw,
  };

  return {
    type: "DATASET",
    title: String(title).trim() || "(untitled dataset)",
    description: raw.description || raw.abstract || raw.summary || null,
    url: canonicalUrl || rawUrl,
    source: "dataset",
    publishedAt: raw.updated_date || raw.updatedAt ? new Date(raw.updated_date || raw.updatedAt) : null,
    metadata: JSON.stringify(metadata),
  };
}

function normalizeResourceRecord(raw) {
  if (!raw || !raw.url) {
    throw new Error(`normalizeResourceRecord: missing required URL field: ${JSON.stringify(raw)}`);
  }

  const rawUrl = raw.url;
  const canonicalUrl = normalizeUrl(rawUrl);
  const title = raw.title || raw.name || raw.resource_name || "(untitled resource)";
  const metadata = {
    rawUrl,
    owner: raw.owner || raw.organization || null,
    resourceType: raw.resource_type || raw.type || raw.resourceType || null,
    author: raw.author || raw.authors || null,
    date: raw.date || raw.updated_at || raw.updatedAt || null,
    sourceMetadata: raw,
  };

  return {
    type: "RESOURCE",
    title: String(title).trim() || "(untitled resource)",
    description: raw.description || raw.summary || null,
    url: canonicalUrl || rawUrl,
    source: "resource",
    publishedAt: raw.updated_at || raw.updatedAt ? new Date(raw.updated_at || raw.updatedAt) : null,
    metadata: JSON.stringify(metadata),
  };
}

function normalizeProjectRecord(raw) {
  if (!raw || !raw.url) {
    throw new Error(`normalizeProjectRecord: missing required URL field: ${JSON.stringify(raw)}`);
  }

  const rawUrl = raw.url;
  const canonicalUrl = normalizeUrl(rawUrl);
  const title = raw.project_name || raw.name || raw.title || "(untitled project)";
  const metadata = {
    rawUrl,
    owner: raw.owner || raw.organization || raw.affiliation || null,
    affiliation: raw.affiliation || raw.organization || null,
    lab: raw.lab || null,
    sourceMetadata: raw,
  };

  return {
    type: "PROJECT",
    title: String(title).trim() || "(untitled project)",
    description: raw.description || raw.summary || null,
    url: canonicalUrl || rawUrl,
    source: "project",
    publishedAt: raw.updated_at || raw.updatedAt ? new Date(raw.updated_at || raw.updatedAt) : null,
    metadata: JSON.stringify(metadata),
  };
}

module.exports = { normalizeArxivRecord, normalizeGithubRecord, normalizeCalderbankRecord, normalizeDatasetRecord, normalizeResourceRecord, normalizeProjectRecord, parseArxivId, normalizeUrl };