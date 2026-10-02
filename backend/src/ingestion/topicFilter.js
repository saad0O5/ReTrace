// Topic relevance filter for ingestion.
//
// Used to decide whether a raw artifact record is relevant to the configured
// research topic before persisting it to the database. This is especially
// important for faculty-publication sources (e.g. duke-calderbank) that return
// an author's complete publication history rather than topic-filtered results.
//
// Reuses the same tokenizer from matching/similarity.js — no new technique,
// no LLM dependency. Pure keyword overlap between the record's title/abstract
// and the configured topic keywords.
//
// Design:
//  - Conservative: a record is considered relevant if ANY of its text contains
//    a sufficient number of topic keywords (not just one, to avoid single-word
//    false positives like "channel" appearing in unrelated CS papers).
//  - Configurable threshold: defaults are sane for OTFS research but can be
//    overridden per source.
//  - Always returns the match details (matched terms, score) so calling code
//    can log or store why a record was accepted/rejected.

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "in", "on", "with", "to", "is",
  "using", "based", "via", "from", "into", "this", "that", "paper", "code",
  "implementation", "official", "repository", "repo",
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
}

// OTFS-domain keywords — covers both signal processing and the broader wireless
// communications context. Intentionally includes adjacent terms so that
// relevant-but-not-OTFS-titled papers are not falsely rejected.
//
// Rule: a record passes if its combined title+description tokens contain at
// least MIN_MATCHING_KEYWORDS of the REQUIRED keywords (exact tokens) OR
// at least MIN_MATCHING_KEYWORDS of the BROADER keywords.
//
// REQUIRED keywords are OTFS-specific. BROADER keywords are the ambient field.
// A record that matches 2+ REQUIRED terms OR 3+ BROADER terms is kept.

const REQUIRED_KEYWORDS = new Set([
  "otfs", "zak", "isac", "isac", "delay-doppler", "doppler",
  "otfs", "zaktransform", "otfsmodulation",
  // Variations often used in titles without exact "OTFS" label:
  "symplectic", "heisenberg",
]);

const BROADER_KEYWORDS = new Set([
  "channel", "estimation", "wireless", "radar", "mimo", "ofdm", "waveform",
  "modulation", "multicarrier", "sensing", "precoding", "beamforming",
  "fading", "doubly", "spread", "coherence", "pilot", "receiver", "detector",
  "sparse", "compressive", "sensing", "compressed", "wideband", "narrowband",
  "spectral", "efficiency", "interference", "isi", "spread", "frequency",
  "delay", "doppler", "lattice", "subspace", "signaling", "transceiver",
  "space-time", "spacetime", "antenna", "ber", "snr", "capacity",
  "multipath", "mobility", "velocity", "rcs", "target",
]);

const MIN_REQUIRED = 1;   // 1 REQUIRED keyword is sufficient (OTFS/Zak etc. are very specific)
const MIN_BROADER = 2;    // OR at least 2 broader field terms (lowered from 3: MIMO-OFDM papers
                          // have focused titles that hit exactly 2 strong domain terms)

/**
 * Determines whether an artifact is relevant to the configured research topic.
 *
 * @param {object} artifact - Normalized artifact object (must have title, description)
 * @param {object} [opts] - Optional overrides
 * @param {number} [opts.minRequired] - Override MIN_REQUIRED threshold
 * @param {number} [opts.minBroader] - Override MIN_BROADER threshold
 * @returns {{ relevant: boolean, matchedRequired: string[], matchedBroader: string[], score: number }}
 */
function isTopicRelevant(artifact, opts = {}) {
  const minRequired = opts.minRequired ?? MIN_REQUIRED;
  const minBroader = opts.minBroader ?? MIN_BROADER;

  const textToCheck = [artifact.title || "", artifact.description || ""].join(" ");
  const tokens = new Set(tokenize(textToCheck));

  const matchedRequired = [...REQUIRED_KEYWORDS].filter((k) => tokens.has(k));
  const matchedBroader = [...BROADER_KEYWORDS].filter((k) => tokens.has(k));

  const relevant =
    matchedRequired.length >= minRequired ||
    matchedBroader.length >= minBroader;

  // Simple score: weighted combination
  const score = Number(
    (matchedRequired.length * 0.6 + matchedBroader.length * 0.1).toFixed(2)
  );

  return {
    relevant,
    matchedRequired,
    matchedBroader,
    score,
  };
}

/**
 * Batch filter: applies isTopicRelevant to an array of normalized artifacts.
 * Returns { kept, rejected, stats }.
 *
 * @param {object[]} artifacts - Array of normalized artifact objects
 * @param {object} [opts] - Passed through to isTopicRelevant
 * @returns {{ kept: object[], rejected: object[], stats: object }}
 */
function filterByTopicRelevance(artifacts, opts = {}) {
  const kept = [];
  const rejected = [];

  for (const artifact of artifacts) {
    const result = isTopicRelevant(artifact, opts);
    if (result.relevant) {
      kept.push({ ...artifact, _relevance: result });
    } else {
      rejected.push({ ...artifact, _relevance: result });
    }
  }

  return {
    kept,
    rejected,
    stats: {
      total: artifacts.length,
      kept: kept.length,
      rejected: rejected.length,
      keepRate: artifacts.length > 0 ? Number((kept.length / artifacts.length).toFixed(3)) : 0,
    },
  };
}

module.exports = { isTopicRelevant, filterByTopicRelevance, tokenize, REQUIRED_KEYWORDS, BROADER_KEYWORDS };
