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
  truncated: boolean;
  char_count: number;
  source_url: string;
}

export interface SearchToolOutput {
  results: SearchResult[];
  total: number;
  query_used: string;
}

export interface MetadataResult {
  celex_id: string;
  title: string;
  date_document: string;
  date_entry_into_force: string;
  date_end_of_validity: string;
  in_force: boolean | null;
  date_transposition: string;
  resource_type: string;
  authors: string[];
  eurovoc_concepts: string[];
  directory_codes: string[];
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

export interface ConsolidatedResult {
  doc_type: string;
  year: number;
  number: number;
  language: string;
  content: string;
  truncated: boolean;
  char_count: number;
  eli_url: string;
}
