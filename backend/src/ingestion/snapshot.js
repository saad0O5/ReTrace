const crypto = require("crypto");
const { normalizeUrl } = require("./urlNormalizer");

/**
 * Builds a deterministic snapshot payload from an artifact observation.
 * Focuses strictly on relevant content fields per artifact type.
 *
 * @param {object} artifact - The normalized artifact object
 * @returns {object} Canonical payload for version comparison and snapshotting
 */
function buildSnapshotPayload(artifact) {
  let meta = {};
  if (artifact.metadata) {
    try {
      meta = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
    } catch (_) {
      meta = {};
    }
  }

  const type = artifact.type;
  const canonicalUrl = normalizeUrl(artifact.url);

  if (type === "PAPER") {
    const authors = Array.isArray(meta.authors) ? [...meta.authors].map((a) => String(a).trim()) : [];
    return {
      type: "PAPER",
      title: String(artifact.title || "").trim(),
      description: artifact.description ? String(artifact.description).trim() : null,
      url: canonicalUrl,
      arxivId: meta.arxivId || null,
      authors: authors.sort(),
      publishedAt: artifact.publishedAt ? new Date(artifact.publishedAt).toISOString() : null,
    };
  }

  if (type === "IMPLEMENTATION") {
    return {
      type: "IMPLEMENTATION",
      title: String(artifact.title || "").trim(),
      description: artifact.description ? String(artifact.description).trim() : null,
      url: canonicalUrl,
      owner: meta.owner ? String(meta.owner).trim() : null,
      repository: meta.repository ? normalizeUrl(meta.repository) : canonicalUrl,
      stars: typeof meta.stars === "number" ? meta.stars : null,
      language: meta.language || null,
    };
  }

  // Generic fallback for any future artifact types
  return {
    type: artifact.type,
    title: String(artifact.title || "").trim(),
    description: artifact.description ? String(artifact.description).trim() : null,
    url: canonicalUrl,
    metadata: meta,
  };
}

/**
 * Computes a deterministic SHA-256 content hash of a snapshot payload.
 * Sorts object keys recursively to ensure bit-level determinism.
 *
 * @param {object} payload - The snapshot payload from buildSnapshotPayload
 * @returns {string} SHA-256 hex string (truncated to 32 chars for compact indexing)
 */
function computeContentHash(payload) {
  function canonicalStringify(obj) {
    if (obj === null || typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map(canonicalStringify).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    const entries = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]));
    return "{" + entries.join(",") + "}";
  }

  const json = canonicalStringify(payload);
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 32);
}

module.exports = {
  buildSnapshotPayload,
  computeContentHash,
};
