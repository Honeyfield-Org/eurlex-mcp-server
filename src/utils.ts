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

/** One heading of a document's outline. */
export interface OutlineEntry {
  /**
   * Nesting-depth hint derived from the heading kind:
   * 1 = part / title / annex (top-level divisions), 2 = chapter, 3 = section,
   * 4 = article. Not a strict tree — a compact ordering cue for rendering.
   */
  level: number;
  /** Normalized heading label, e.g. "Article 5", "CHAPTER I", "ANNEX III". */
  label: string;
  /** The heading's subtitle (the following non-empty line), or '' when there is none. */
  title: string;
  /**
   * 0-based character offset of the label's first character WITHIN the processed
   * plain text — i.e. within `stripHtml(raw)`, which is exactly the string
   * `processContent(raw, 'plain', …)` slices. So `eurlex_fetch(celex, format:
   * 'plain', offset)` starts reading precisely at this heading. This coupling is
   * correct by construction: the parser measures offsets in the same string the
   * fetch tool slices.
   */
  offset: number;
}

export interface Outline {
  /** Headings in document order, capped at `maxEntries`. */
  entries: OutlineEntry[];
  /** Total headings detected before the cap. */
  total: number;
  /** True when `entries` was truncated to `maxEntries` (total > maxEntries). */
  truncated: boolean;
}

/**
 * Whitespace inside/around a heading line. EUR-Lex OJ markup separates a label
 * from its designator with either an ASCII space (e.g. GDPR "Article 5") or a
 * literal U+00A0 no-break space (e.g. AI Act renders "Article 5" with U+00A0) — stripHtml
 * collapses neither U+00A0 (its `[ \t]+` collapse is ASCII-only). Both must be
 * accepted everywhere a heading is matched.
 */
const HWS = ' \\t\\u00A0';
const ROMAN = '[IVXLCDM]+';

/**
 * Ordered heading rules. Each matches a WHOLE plain-text line — the line must be
 * nothing but the marker word plus its designator — which is what distinguishes a
 * real heading (its own line in the stripped text) from a mid-sentence
 * cross-reference like "as referred to in Article 5(1)". First match wins;
 * the keyword sets are disjoint so order only fixes the reported `level`.
 *
 * Keywords cover English, German and French — the languages whose structural
 * vocabulary this server verifies. A document fetched in another language yields
 * a sparse or empty outline (still offset-correct); fetch in English for the
 * fullest structure. Casing variants ("SECTION"/"Section") are listed explicitly
 * rather than using the `i` flag, so a word is only ever a heading in a form
 * EUR-Lex actually emits.
 *
 * Capture groups (uniform across rules): 1 = leading whitespace, 2 = keyword,
 * 3 = designator (undefined only for a bare "ANNEX").
 */
interface HeadingRule {
  level: number;
  re: RegExp;
}
const HEADING_RULES: HeadingRule[] = [
  {
    level: 1,
    re: new RegExp(
      `^([${HWS}]*)(PART|Part|TEIL|Teil|PARTIE|Partie)[${HWS}]+(${ROMAN}|\\d+)[${HWS}]*$`,
    ),
  },
  {
    level: 1,
    re: new RegExp(
      `^([${HWS}]*)(TITLE|Title|TITEL|Titel|TITRE|Titre)[${HWS}]+(${ROMAN}|\\d+)[${HWS}]*$`,
    ),
  },
  {
    level: 2,
    re: new RegExp(
      `^([${HWS}]*)(CHAPTER|Chapter|KAPITEL|Kapitel|CHAPITRE|Chapitre)[${HWS}]+(${ROMAN}|\\d+)[${HWS}]*$`,
    ),
  },
  {
    level: 3,
    re: new RegExp(
      `^([${HWS}]*)(SECTION|Section|ABSCHNITT|Abschnitt)[${HWS}]+(\\d+|${ROMAN})[${HWS}]*$`,
    ),
  },
  {
    level: 4,
    re: new RegExp(
      `^([${HWS}]*)(ARTICLE|Article|article|ARTIKEL|Artikel)[${HWS}]+(\\d+[a-z]?)[${HWS}]*$`,
    ),
  },
  {
    level: 1,
    re: new RegExp(
      `^([${HWS}]*)(ANNEX|Annex|ANHANG|Anhang|ANNEXE|Annexe)(?:[${HWS}]+(${ROMAN}|\\d+|[A-Z]))?[${HWS}]*$`,
    ),
  },
];

interface MatchedHeading {
  level: number;
  label: string;
  /** Offset of the label's first char within its line (length of leading whitespace). */
  labelStart: number;
}

/** Tests a single plain-text line against the heading rules; null when it is not a heading. */
function matchHeading(line: string): MatchedHeading | null {
  for (const { level, re } of HEADING_RULES) {
    const m = re.exec(line);
    if (!m) continue;
    const [, lead, keyword, designator] = m;
    const label = designator ? `${keyword} ${designator}` : keyword;
    return { level, label, labelStart: lead.length };
  }
  return null;
}

/**
 * The subtitle of a heading: the next non-empty line, unless that line is itself
 * a heading (then there is no subtitle). Scans a few lines ahead to skip the
 * blank lines OJ markup leaves between a heading and its title. U+00A0 is
 * normalized to a space and the result capped so a title-less heading followed
 * by a long body paragraph does not drag the whole paragraph into the outline.
 */
function subtitleAfter(lines: string[], i: number): string {
  for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
    const norm = lines[j]
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!norm) continue;
    if (matchHeading(lines[j])) return '';
    return norm.length > 160 ? norm.slice(0, 160).trimEnd() : norm;
  }
  return '';
}

/**
 * Extracts a document outline (chapters, sections, articles, annexes, …) from
 * ALREADY-PROCESSED plain text — the output of `stripHtml`, i.e. the exact string
 * `processContent(raw, 'plain', …)` slices. Heading offsets are therefore
 * positions the `eurlex_fetch` plain-text pagination can be steered to directly
 * (see OutlineEntry.offset). Detection is regex-on-plain-text (not XHTML-class
 * mapping) precisely so offsets are correct by construction rather than mapped
 * across the strip pipeline's entity-decode / whitespace-collapse steps.
 *
 * `maxEntries` caps the returned list (the outline stays compact for huge acts);
 * `total` still reports the full count and `truncated` flags the cap.
 */
export function parseOutline(plainText: string, maxEntries = 300): Outline {
  const lines = plainText.split('\n');
  const entries: OutlineEntry[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = matchHeading(line);
    if (h) {
      entries.push({
        level: h.level,
        label: h.label,
        title: subtitleAfter(lines, i),
        offset: offset + h.labelStart,
      });
    }
    // split('\n') consumed exactly one '\n' (1 char) after each line but the last.
    offset += line.length + 1;
  }
  const total = entries.length;
  const truncated = total > maxEntries;
  return { entries: truncated ? entries.slice(0, maxEntries) : entries, total, truncated };
}
