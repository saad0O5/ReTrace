// Centralized deterministic URL normalization for ReTrace.
// Ensures research artifacts are indexed by canonical identity rather than
// cosmetic URL variations (trailing slashes, tracking params, casing, fragments).

// Known tracking parameters safe to strip without changing resource identity
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "trk",
  "_ga",
  "_gl",
  "ref",
  "ref_src",
  "ref_page",
]);

/**
 * Normalizes a URL deterministically.
 * @param {string} rawUrl - The input URL to normalize
 * @returns {string|null} Canonical normalized URL, or null if input is invalid
 */
function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // Handle protocol-relative URLs (e.g. "//arxiv.org/abs/...")
    let urlString = trimmed;
    if (urlString.startsWith("//")) {
      urlString = `https:${urlString}`;
    } else if (!urlString.includes("://")) {
      urlString = `https://${urlString}`;
    }

    const parsed = new URL(urlString);

    // 1. Lowercase protocol and hostname
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // 2. Remove standard default ports
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }

    // 3. Remove URL fragment/hash entirely (fragments are client-side navigation)
    parsed.hash = "";

    // 4. Clean pathname
    let pathname = parsed.pathname;

    // Remove redundant multiple slashes (e.g. //abs///1234 -> /abs/1234)
    pathname = pathname.replace(/\/+/g, "/");

    // Remove trailing slash if path is longer than "/"
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // Specific domain normalization:
    // GitHub: remove .git suffix from repository paths (e.g. /owner/repo.git -> /owner/repo)
    if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
      parsed.hostname = "github.com";
      if (pathname.endsWith(".git")) {
        pathname = pathname.slice(0, -4);
      }
    }

    // arXiv: standardize hostname and abs paths
    if (parsed.hostname === "arxiv.org" || parsed.hostname === "www.arxiv.org") {
      parsed.hostname = "arxiv.org";
      parsed.protocol = "https:";
    }

    parsed.pathname = pathname;

    // 5. Clean and sort query parameters conservatively
    const searchParams = new URLSearchParams(parsed.search);
    const keysToDelete = [];

    for (const [key] of searchParams.entries()) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      searchParams.delete(key);
    }

    // Sort remaining query parameters deterministically by key, then value
    const sortedEntries = Array.from(searchParams.entries()).sort((a, b) => {
      const keyCmp = a[0].localeCompare(b[0]);
      return keyCmp !== 0 ? keyCmp : a[1].localeCompare(b[1]);
    });

    const cleanParams = new URLSearchParams();
    for (const [k, v] of sortedEntries) {
      cleanParams.append(k, v);
    }

    const searchString = cleanParams.toString();
    parsed.search = searchString ? `?${searchString}` : "";

    return parsed.toString();
  } catch (_) {
    // If standard URL parsing fails, return trimmed original string as fallback
    return trimmed;
  }
}

module.exports = { normalizeUrl, TRACKING_PARAMS };
