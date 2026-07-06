export const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
export const CELLAR_REST_BASE = 'https://publications.europa.eu/resource/celex';
export const EURLEX_BASE = 'https://eur-lex.europa.eu/legal-content';

/**
 * Cellar content-negotiation MIME for a LEGISSUM summary's XHTML manifestation.
 * LEGISSUM summary works carry an `xhtml5`-typed manifestation (not the plain
 * `xhtml` legal acts use), and Cellar's negotiation is strict: requesting the
 * summary work URI with bare `application/xhtml+xml` returns 404 ("no content
 * datastream of the requested type"). The exact item MIME `application/
 * xhtml+xml;type=xhtml5` is required (probed 2026-07-05 on the GDPR/DSA summaries).
 */
export const CELLAR_SUMMARY_MIME = 'application/xhtml+xml;type=xhtml5';

/**
 * Cap on the LEGISSUM-summary lookup query. One act usually has a single summary;
 * treaty articles / framework communications can have dozens (max observed 54 for
 * 52011DC0666, probed 2026-07-05), so 100 covers every real case while keeping the
 * anchored query bounded. total_summaries is derived from the returned rows.
 */
export const SUMMARY_LOOKUP_LIMIT = 100;
export const DEFAULT_LANGUAGE = 'DEU';
export const DEFAULT_LIMIT = 10;
// Pagination-window bounds shared by the max_chars param of eurlex_fetch,
// eurlex_consolidated and eurlex_summary: min 1000, default 20000, hard cap
// 50000 chars per call (a document longer than one window is read across calls
// via offset/next_offset). Single source of truth so the three schemas can't drift.
export const MAX_CHARS_MIN = 1000;
export const MAX_CHARS_DEFAULT = 20000;
export const MAX_CHARS_LIMIT = 50000;
export const REQUEST_TIMEOUT_MS = 30000;
export const SESSION_TTL_MS = 30 * 60 * 1000;

// Retry policy for Cellar SPARQL/REST calls: retry on network errors, timeouts,
// and HTTP 5xx — never on 4xx. Max 2 retries with 500ms then 1500ms delay.
// MAX_RETRIES is derived from RETRY_DELAYS_MS.length so the two can never drift
// apart (e.g. in an error message reporting the retry count).
export const RETRY_DELAYS_MS = [500, 1500] as const;
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

// {4,30} — supports parenthesized corrigenda suffixes, e.g. 32023D2454(02)
export const CELEX_REGEX = /^\d[A-Z0-9()]{4,30}$/;

// In-memory TTL caches on CellarClient (Task 6). Expiry is checked on read
// only — no background timers. Errors are never cached; legitimate "not
// found" (null) results ARE cached, since re-querying Cellar for the same
// non-existent lookup within the TTL window would be wasted work.
export const EUROVOC_LABEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EUROVOC_LABEL_CACHE_MAX_ENTRIES = 500;
export const CONSOLIDATED_CELEX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const CONSOLIDATED_CELEX_CACHE_MAX_ENTRIES = 500;
export const METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const METADATA_CACHE_MAX_ENTRIES = 200;

// eurlex_sparql (Task 7) — raw read-only SPARQL escape hatch.
// Query length bounds keep abusive/empty payloads out before any parsing.
export const SPARQL_QUERY_MIN_LENGTH = 10;
export const SPARQL_QUERY_MAX_LENGTH = 5000;
// LIMIT policy: append this when the SELECT has no top-level LIMIT; reject a
// top-level LIMIT above the max. Fairness/token-budget cap on a public endpoint,
// not a security control.
export const SPARQL_DEFAULT_LIMIT = 50;
export const SPARQL_MAX_LIMIT = 100;
// Bindings are truncated (whole rows dropped) to keep the serialized response
// at or below this many characters; the response then carries `truncated: true`.
export const SPARQL_RESPONSE_CHAR_BUDGET = 40000;

export const RESOURCE_TYPES = [
  'REG',
  'REG_IMPL',
  'REG_DEL',
  'DIR',
  'DIR_IMPL',
  'DIR_DEL',
  'DEC',
  'DEC_IMPL',
  'DEC_DEL',
  'JUDG',
  'ORDER',
  'OPIN_AG',
  'RECO',
  'any',
] as const;
