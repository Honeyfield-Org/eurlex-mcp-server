import type { OutlineEntry } from './utils.js';

export interface SparqlQueryParams {
  query: string;
  resource_type: string;
  language: string;
  limit: number;
  date_from?: string;
  date_to?: string;
}

export interface SearchResult {
  celex: string;
  title: string;
  date: string;
  type: string;
  eurlex_url: string;
}

export interface FetchResult {
  celex_id: string;
  language: string;
  content: string;
  /** True when more content remains beyond `offset + returned_chars`. */
  truncated: boolean;
  /** Length of `content` in this response. */
  returned_chars: number;
  /** Length of the full processed (post-strip) document. */
  total_chars: number;
  /** The offset this response was sliced from. */
  offset: number;
  /** Offset to request next to continue reading, or `null` when there is no more content. */
  next_offset: number | null;
  source_url: string;
}

export interface SearchToolOutput {
  results: SearchResult[];
  total: number;
}

export interface MetadataResult {
  celex_id: string;
  title: string;
  /** ISO date, or null when absent. */
  date_document: string | null;
  /** ISO date, or null when absent. */
  date_entry_into_force: string | null;
  /** ISO date, or null when absent OR when it is the Cellar `9999-12-31` sentinel. */
  date_end_of_validity: string | null;
  in_force: boolean | null;
  /** ISO date, or null when absent. */
  date_transposition: string | null;
  resource_type: string;
  authors: string[];
  eurovoc_concepts: string[];
  /** Directory-code entries as `"{code-tail}: {label}"`, or the bare code tail when unlabelled. */
  directory_codes: string[];
  /** CELEX IDs of the legal acts this act is based on (its legal basis). */
  legal_basis: string[];
  eurlex_url: string;
}

export interface CitationEntry {
  celex: string;
  title: string;
  date: string;
  type: string;
  relationship:
    | 'cites'
    | 'cited_by'
    | 'amends'
    | 'amended_by'
    | 'based_on'
    | 'basis_for'
    | 'repeals'
    | 'repealed_by';
  eurlex_url: string;
}

export interface CitationsResult {
  celex_id: string;
  citations: CitationEntry[];
  total: number;
  /**
   * How the returned citations split across the two directions.
   * `cites` counts cites/based_on/amends/repeals rows (this act references others);
   * `cited_by` counts the inverse rows (other acts reference this one).
   */
  counts: { cites: number; cited_by: number };
}

export interface CaseLawQueryParams {
  /** Title substring to search for among case law (case-insensitive CONTAINS). */
  query?: string;
  /** Sector-6 CELEX of a specific ruling to look up. */
  celex_id?: string;
  /** ECLI of a specific ruling to look up. */
  ecli?: string;
  /** CELEX of a legal act; returns case law interpreting it. */
  related_celex?: string;
  /** COURT_JUSTICE | GENERAL_COURT | any */
  court: string;
  /** JUDG | ORDER | OPIN_AG | any */
  type: string;
  language: string;
  limit: number;
  date_from?: string;
  date_to?: string;
}

export interface CaseLawEntry {
  celex: string;
  /** ECLI, or '' when the work carries none (mirrors `date: ''` for absent dates). */
  ecli: string;
  title: string;
  date: string;
  type: string;
  eurlex_url: string;
}

export interface CaseLawResult {
  results: CaseLawEntry[];
  total: number;
}

export interface TranspositionQueryParams {
  /** Sector-3 CELEX of the EU directive whose national implementing measures are wanted. */
  celex_id: string;
  /** Optional 2-letter member-state code (validated COUNTRY_ENUM) to filter by. */
  country?: string;
  /** Language code; sets the eurlex_url locale (does NOT translate NIM titles). */
  language: string;
  limit: number;
}

export interface TranspositionEntry {
  /** Member state: 2-letter code when known, else the raw alpha-3 authority code (e.g. "GBR"). */
  country: string;
  /** National measure title, in the member state's own language (or '' when absent). */
  title: string;
  /** ISO date of the national measure's document, or '' when absent. */
  date: string;
  /** Sector-7 NIM CELEX, e.g. "72022L2555DEU_202500123". */
  celex: string;
  eurlex_url: string;
}

export interface TranspositionResult {
  /** The directive CELEX that was queried. */
  celex_id: string;
  results: TranspositionEntry[];
  /** Number of measures in `results` (<= limit). */
  returned: number;
  /** Full number of matching measures; when > returned, `results` was truncated to limit. */
  total_found: number;
}

export interface StructureResult {
  /** The resolved CELEX ID (echoed so the follow-up eurlex_fetch call is unambiguous). */
  celex_id: string;
  language: string;
  /** Total headings detected in the document (before the returned-list cap). */
  total_headings: number;
  /** Number of headings in `outline` (<= total_headings; capped for very large acts). */
  returned: number;
  /** True when `outline` was capped below total_headings. */
  truncated: boolean;
  /**
   * Length of the processed plain text — the same total_chars eurlex_fetch reports
   * for format:"plain". Offsets in `outline` index into this text.
   */
  total_chars: number;
  /** Chapters/sections/articles/annexes with their plain-text offsets, in document order. */
  outline: OutlineEntry[];
  source_url: string;
  /** Present only when no headings were detected — explains why and what to try. */
  note?: string;
}

export interface ConsolidatedResult {
  doc_type: string;
  year: number;
  number: number;
  language: string;
  content: string;
  /** True when more content remains beyond `offset + returned_chars`. */
  truncated: boolean;
  /** Length of `content` in this response. */
  returned_chars: number;
  /** Length of the full processed (post-strip) document. */
  total_chars: number;
  /** The offset this response was sliced from. */
  offset: number;
  /** Offset to request next to continue reading, or `null` when there is no more content. */
  next_offset: number | null;
  eli_url: string;
  /** The resolved consolidated CELEX ID, e.g. "02016R0679-20160504". */
  consolidated_celex: string;
  /** ISO date parsed from the CELEX's "-YYYYMMDD" suffix, or `null` when absent. */
  consolidation_date: string | null;
}
