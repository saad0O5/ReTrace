// Paper <-> Repository matching (architecture.md Phase 5 — "the more than a
// scraper" layer). Deterministic, no LLM dependency: title/keyword overlap,
// author overlap, and URL domain signals. Every match stores its evidence,
// never a bare score — an unexplained confidence number isn't trustworthy
// to a judge or to us.

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "in", "on", "with", "to", "is",
  "using", "based", "via", "from", "into", "this", "that", "paper", "code",
  "implementation", "official", "repository", "repo", "channel", "estimation",
  "otfs", // domain term shared by nearly everything in this research space —
           // it would inflate every pair's score without discriminating
           // between them, so it's excluded from the overlap calculation.
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
}

/**
 * Extract normalized author names from an artifact's metadata.
 * Returns lowercase tokens for comparison.
 */
function extractAuthorTokens(artifact) {
  const meta = artifact.metadata || {};
  const authors = meta.authors || [];
  if (!authors.length) return [];
  return authors
    .map((a) => String(a).toLowerCase().replace(/[^a-z\s]/g, '').trim())
    .filter(Boolean);
}

/**
 * Extract the domain from a URL for same-domain affinity scoring.
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return null;
  }
}

/**
 * Jaccard-style overlap between two token sets, plus the actual overlapping
 * terms (this is the evidence, not just the number).
 */
function keywordOverlap(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const shared = [...setA].filter((t) => setB.has(t));
  const union = new Set([...setA, ...setB]);
  const score = union.size === 0 ? 0 : shared.length / union.size;
  return { score, shared };
}

/**
 * Score a single (paper, repo) pair.
 * Inputs are the normalized Artifact objects (title, description, metadata).
 * Returns { confidence, evidence } — evidence is a plain-language array,
 * always populated, never just a number.
 */
function scorePaperRepoPair(paper, repo) {
  const paperTitleTokens = tokenize(paper.title);
  const paperDescTokens = tokenize(paper.description);
  const repoTitleTokens = tokenize(repo.title);
  const repoDescTokens = tokenize(repo.description);

  const titleVsTitle = keywordOverlap(paperTitleTokens, repoTitleTokens);
  const titleVsRepoDesc = keywordOverlap(paperTitleTokens, repoDescTokens);
  const descVsDesc = keywordOverlap(paperDescTokens, repoDescTokens);

  // Author overlap signal: if a paper's author name appears in the repo
  // description or owner field, that's a strong indicator of real provenance.
  const paperAuthors = extractAuthorTokens(paper);
  const repoAuthors = extractAuthorTokens(repo);
  const repoOwner = (repo.metadata?.owner || '').toLowerCase();
  let authorBonus = 0;
  const authorEvidence = [];
  if (paperAuthors.length) {
    const repoText = [repo.description, repoOwner, ...repoAuthors].join(' ').toLowerCase();
    const matchedAuthors = paperAuthors.filter((a) => {
      const nameTokens = a.split(/\s+/).filter((t) => t.length > 2);
      return nameTokens.some((t) => repoText.includes(t));
    });
    if (matchedAuthors.length > 0) {
      authorBonus = Math.min(0.15, matchedAuthors.length * 0.05);
      authorEvidence.push(`Author name overlap: ${matchedAuthors.join(', ')}`);
    }
  }

  // URL domain affinity: if both artifacts reference the same domain
  // (e.g., a paper on arxiv.org links to a repo mentioning arxiv in desc)
  let domainBonus = 0;
  const paperDomain = extractDomain(paper.url);
  const repoDomain = extractDomain(repo.url);
  if (paperDomain && repoDomain && paperDomain === repoDomain) {
    domainBonus = 0.05;
  }

  // Weighted: a repo whose OWN description echoes the paper's title is a much
  // stronger signal than two long abstracts sharing generic domain words, so
  // title<->description overlap is weighted highest.
  const baseConfidence =
    titleVsTitle.score * 0.35 +
    titleVsRepoDesc.score * 0.45 +
    descVsDesc.score * 0.2;

  const confidence = Math.min(1.0, baseConfidence + authorBonus + domainBonus);

  const evidence = [];
  if (titleVsTitle.shared.length > 0) {
    evidence.push(`Paper title and repo title share: ${titleVsTitle.shared.join(", ")}`);
  }
  if (titleVsRepoDesc.shared.length > 0) {
    evidence.push(`Paper title terms appear in repo description: ${titleVsRepoDesc.shared.join(", ")}`);
  }
  if (descVsDesc.shared.length > 0) {
    evidence.push(`Shared terms between paper abstract and repo description: ${descVsDesc.shared.join(", ")}`);
  }
  evidence.push(...authorEvidence);
  if (domainBonus > 0) {
    evidence.push(`Same domain: ${paperDomain}`);
  }
  if (evidence.length === 0) {
    evidence.push("No meaningful keyword overlap found.");
  }

  return { confidence: Number(confidence.toFixed(3)), evidence };
}

/**
 * Given a list of Paper artifacts and a list of Implementation artifacts,
 * return candidate matches above `threshold`, sorted by confidence descending.
 * This does NOT write to the DB — resolver.js owns persistence, this module
 * is pure scoring so it stays testable in isolation.
 */
function findCandidateMatches(papers, repos, threshold = 0.08) {
  const candidates = [];
  for (const paper of papers) {
    for (const repo of repos) {
      const { confidence, evidence } = scorePaperRepoPair(paper, repo);
      if (confidence >= threshold) {
        candidates.push({ paper, repo, confidence, evidence });
      }
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

module.exports = { tokenize, keywordOverlap, scorePaperRepoPair, findCandidateMatches };