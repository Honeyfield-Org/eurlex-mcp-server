/** HTML entity decodings applied after tag stripping. `&amp;` must run last so
 * an already-literal sequence like `&amp;lt;` (representing the text `&lt;`)
 * is not double-decoded into `<`. */
const ENTITY_REPLACEMENTS: [RegExp, string][] = [
  [/&nbsp;|&#160;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&amp;/gi, '&'],
];

/**
 * Converts HTML/XHTML into compact plain text: strips tags, decodes common
 * entities, collapses runs of horizontal whitespace, trims trailing
 * whitespace per line, and collapses 3+ consecutive newlines to 2.
 *
 * Live finding: EUR-Lex table-layout markup (e.g. GDPR) renders as long runs
 * of blank lines once tags are removed — collapsing those is the single
 * biggest token saving for `plain` format output.
 */
export function stripHtml(content: string): string {
  let text = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '');

  for (const [pattern, replacement] of ENTITY_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Sorts rows by date descending (empty/missing dates last), deduplicates by
 * `celex` (a work can carry multiple resource-types, so the same CELEX may
 * appear more than once), then slices to `limit`.
 *
 * Shared by CellarClient.sparqlQuery() and CellarClient.caseLawQuery(): both
 * build their SPARQL query WITHOUT `ORDER BY` and oversample the SPARQL
 * `LIMIT` (see buildSparqlQuery / buildCaseLawQuery for why — `ORDER BY
 * DESC(?date)` forces Virtuoso to materialize the full result set before
 * applying LIMIT, which times out for broad queries), so this client-side
 * pipeline does the sort/dedup/slice instead.
 *
 * ISO date strings sort lexicographically = chronologically. Array.sort is
 * stable, so equal-date rows (including same-CELEX duplicates) keep their
 * original order — dedup then keeps the first (newest, or original-order for
 * ties) occurrence per CELEX.
 */
export function sortDedupSlice<T extends { celex: string; date: string }>(
  rows: T[],
  limit: number,
): T[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === '') return 1;
    if (b.date === '') return -1;
    return a.date < b.date ? 1 : -1;
  });

  const seen = new Set<string>();
  const deduped = sorted.filter((r) => {
    if (seen.has(r.celex)) return false;
    seen.add(r.celex);
    return true;
  });

  return deduped.slice(0, limit);
}

export function toolError(error: unknown): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

export interface ProcessedContent {
  content: string;
  truncated: boolean;
  /** Length of `content` in this response. */
  returned_chars: number;
  /** Length of the full processed (post-strip) document. */
  total_chars: number;
  /** The offset this response was sliced from. */
  offset: number;
  /** Offset to request next to continue reading, or `null` when there is no more content. */
  next_offset: number | null;
}

/**
 * Processes raw document content for a tool response: strips HTML first (for
 * `plain` format), then slices out an `[offset, offset + maxChars)` window of
 * the processed text. Offsets at or beyond the end of the document return
 * empty content with `truncated: false`.
 */
export function processContent(
  raw: string,
  format: 'plain' | 'xhtml',
  maxChars: number,
  offset = 0,
): ProcessedContent {
  const processed = format === 'plain' ? stripHtml(raw) : raw;
  const total_chars = processed.length;
  const content = processed.slice(offset, offset + maxChars);
  const returned_chars = content.length;
  const truncated = offset + returned_chars < total_chars;
  const next_offset = truncated ? offset + returned_chars : null;
  return { content, truncated, returned_chars, total_chars, offset, next_offset };
}
