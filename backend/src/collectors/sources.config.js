// Source definitions for ReTrace.
// collectorId is intentionally blank until you create it, e.g.:
//   bdata scraper create "https://arxiv.org/search/?query={topic}" "paper title, authors, abstract, published date, url, arxiv id"
//   bdata scraper create "https://github.com/search?q={topic}&type=repositories" "repo name, owner, description, url, language, stars, last updated"
// Paste the returned c_xxxx collector IDs into backend/.env — this file reads them from there.
//
// IMPORTANT (confirmed against the dashboard's "Initiate by API" tab):
// The collector's trigger input is { "url": "<fully resolved URL>" } — NOT { "topic": "..." }.
// Bright Data does not substitute {topic} for you; resolveSourceInput() below does that
// ourselves before the request goes out.

const sources = {
  arxiv: {
    name: "arxiv",
    urlTemplate: "https://arxiv.org/search/?query={topic}",
    collectorId: process.env.BRIGHTDATA_ARXIV_COLLECTOR_ID || "",
    collectorType: "scraper",
    artifactTypes: ["PAPER"],
    type: "PAPER",
    enabled: true,
    description: "Academic paper discovery and metadata collection for the research topic.",
    expectedRecordShape: "paper_title, authors[], abstract, url, arxiv_id, published_date",
  },
  github: {
    name: "github",
    urlTemplate: "https://github.com/search?q={topic}&type=repositories",
    collectorId: process.env.BRIGHTDATA_GITHUB_COLLECTOR_ID || "",
    collectorType: "scraper",
    artifactTypes: ["IMPLEMENTATION"],
    type: "IMPLEMENTATION",
    enabled: true,
    description: "Public implementation repositories and code resources associated with the topic.",
    expectedRecordShape: "repo_name, owner, description, url, language, stars, last_updated",
  },
  "duke-calderbank": {
    name: "duke-calderbank",
    urlTemplate: "https://fds.duke.edu/db/aas/math/faculty/robert.calderbank/publications",
    collectorId: process.env.BRIGHTDATA_DUKE_CALDERBANK_COLLECTOR_ID || "",
    collectorType: "scraper",
    artifactTypes: ["PAPER"],
    type: "PAPER",
    enabled: true,
    description: "Public faculty publication page for a real long-tail academic source.",
    expectedRecordShape: "title, authors, description, publication URL, year, venue",
  },
  fixture: {
    name: "fixture",
    urlTemplate: "https://saad0o5.github.io/ReTrace-Fixture/",
    collectorId: process.env.BRIGHTDATA_FIXTURE_COLLECTOR_ID || "",
    collectorType: "scraper",
    artifactTypes: ["PAPER"],
    type: "PAPER",
    enabled: true,
    description: "Deterministic test fixture for source-health and self-healing validation.",
    expectedRecordShape: "fixed fixture record set for selector recovery testing",
  },
};

/**
 * Resolve a source's URL template into the exact trigger input Bright Data expects.
 * @param {object} source - one of the entries in `sources` above
 * @param {string} topic
 * @returns {{url: string}}
 */
function resolveSourceInput(source, topic) {
  const resolvedUrl = source.urlTemplate.replace("{topic}", encodeURIComponent(topic));
  return { url: resolvedUrl };
}

module.exports = { sources, resolveSourceInput };