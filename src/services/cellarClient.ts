import {
  SPARQL_ENDPOINT,
  CELLAR_REST_BASE,
  EURLEX_BASE,
  DEFAULT_LANGUAGE,
  DEFAULT_LIMIT,
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  EUROVOC_LABEL_CACHE_TTL_MS,
  EUROVOC_LABEL_CACHE_MAX_ENTRIES,
  CONSOLIDATED_CELEX_CACHE_TTL_MS,
  CONSOLIDATED_CELEX_CACHE_MAX_ENTRIES,
  METADATA_CACHE_TTL_MS,
  METADATA_CACHE_MAX_ENTRIES,
} from '../constants.js';
import { LANGUAGE_ISO_MAP } from '../languages.js';
import type {
  SparqlQueryParams,
  SearchResult,
  MetadataResult,
  CitationsResult,
  CitationEntry,
  CaseLawQueryParams,
  CaseLawEntry,
  CaseLawResult,
} from '../types.js';

import { normalizeEliToCanonicalUri, normalizeOjRefToResourceUri } from './identifiers.js';
import { TtlCache } from './ttlCache.js';

/**
 * Fallback ISO 639-1 tag when a language code is unknown to LANGUAGE_ISO_MAP.
 * In practice unreachable — the `language` field of every tool schema is
 * Zod-validated against LANGUAGE_ENUM, whose codes are exactly the map keys.
 * "de" keeps the pre-existing behaviour for any internal caller that passes a
 * raw (non-schema) code.
 */
const DEFAULT_ISO = 'de';

/** Valid citation relationship types between EU legal acts */
export const VALID_RELATIONSHIPS = new Set<CitationEntry['relationship']>([
  'cites',
  'cited_by',
  'amends',
  'amended_by',
  'based_on',
  'basis_for',
  'repeals',
  'repealed_by',
]);

/**
 * Relationships that belong to the "cites" side (this act references others).
 * Their inverses (cited_by/basis_for/amended_by/repealed_by) form the "cited_by"
 * side. Used to compute CitationsResult.counts regardless of query direction.
 */
const CITES_SIDE_RELATIONSHIPS = new Set<CitationEntry['relationship']>([
  'cites',
  'based_on',
  'amends',
  'repeals',
]);

/** Shape of a single SPARQL binding value */
interface SparqlBindingValue {
  type: string;
  value: string;
}

/** Shape of the metadata SPARQL JSON results */
interface MetadataSparqlResponse {
  results: {
    bindings: {
      title?: SparqlBindingValue;
      dateDoc?: SparqlBindingValue;
      dateForce?: SparqlBindingValue;
      dateEnd?: SparqlBindingValue;
      inForce?: SparqlBindingValue;
      dateTrans?: SparqlBindingValue;
      resType?: SparqlBindingValue;
      authors?: SparqlBindingValue;
      eurovoc?: SparqlBindingValue;
      dirCodes?: SparqlBindingValue;
      legalBases?: SparqlBindingValue;
    }[];
  };
}

/** Shape of the citations SPARQL JSON results */
interface CitationsSparqlResponse {
  results: {
    bindings: {
      celex: SparqlBindingValue;
      title: SparqlBindingValue;
      date?: SparqlBindingValue;
      resType: SparqlBindingValue;
      rel: SparqlBindingValue;
    }[];
  };
}

/** Shape of the case-law SPARQL JSON results */
interface CaseLawSparqlResponse {
  results: {
    bindings: {
      celex: SparqlBindingValue;
      ecli?: SparqlBindingValue;
      title: SparqlBindingValue;
      date?: SparqlBindingValue;
      resType: SparqlBindingValue;
    }[];
  };
}

/** Shape of the SPARQL JSON results */
interface SparqlResponse {
  results: {
    bindings: {
      work: SparqlBindingValue;
      celex: SparqlBindingValue;
      title: SparqlBindingValue;
      date?: SparqlBindingValue;
      resType: SparqlBindingValue;
    }[];
  };
}

/**
 * Escapes a string for safe inclusion in a SPARQL literal.
 * Escapes backslashes and double-quotes.
 */
export function escapeSparqlString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '');
}

/**
 * Error carrying an HTTP status code, so the retry logic can decide
 * (based on the status alone) whether a failure is retryable.
 */
class HttpStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

/** True for DOMException/Error-like objects representing an aborted/timed-out request. */
function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

/**
 * Decides whether a failure from executeSparql/fetchCellarDocument should be retried:
 * network errors (TypeError from fetch), timeouts (AbortError/TimeoutError), and
 * HTTP 5xx. Never 4xx or other errors.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status >= 500;
  }
  if (error instanceof TypeError) {
    return true;
  }
  return isTimeoutError(error);
}

export interface CellarClientOptions {
  /** Injectable delay for retry backoff — defaults to a real setTimeout-based sleep. */
  retryDelayFn?: (ms: number) => Promise<void>;
  /** Injectable clock for the TTL caches — defaults to `Date.now`. */
  now?: () => number;
}

export class CellarClient {
  private readonly retryDelayFn: (ms: number) => Promise<void>;

  // Instance-level TTL caches (Task 6) — expiry on read only, no timers.
  // Errors are never cached; a legitimate "not found" (null) result is.
  private readonly eurovocLabelCache: TtlCache<string | null>;
  private readonly consolidatedCelexCache: TtlCache<string | null>;
  private readonly metadataCache: TtlCache<MetadataResult>;

  constructor(options: CellarClientOptions = {}) {
    this.retryDelayFn =
      options.retryDelayFn ??
      ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

    const now = options.now ?? Date.now;
    this.eurovocLabelCache = new TtlCache(
      EUROVOC_LABEL_CACHE_MAX_ENTRIES,
      EUROVOC_LABEL_CACHE_TTL_MS,
      now,
    );
    this.consolidatedCelexCache = new TtlCache(
      CONSOLIDATED_CELEX_CACHE_MAX_ENTRIES,
      CONSOLIDATED_CELEX_CACHE_TTL_MS,
      now,
    );
    this.metadataCache = new TtlCache(METADATA_CACHE_MAX_ENTRIES, METADATA_CACHE_TTL_MS, now);
  }

  /**
   * Runs `fn`, retrying on retryable failures (network errors, timeouts, HTTP 5xx)
   * with backoff delays from RETRY_DELAYS_MS. Never retries 4xx or other errors.
   * Rethrows the last error once retries are exhausted.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length || !isRetryableError(error)) {
          throw error;
        }
        await this.retryDelayFn(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  private async executeSparql<T>(sparql: string): Promise<T> {
    try {
      return await this.withRetry(async () => {
        const response = await fetch(SPARQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sparql-query',
            Accept: 'application/sparql-results+json',
          },
          body: sparql,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new HttpStatusError(`SPARQL endpoint error: ${response.status}`, response.status);
        }
        return (await response.json()) as T;
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        const seconds = Math.round(REQUEST_TIMEOUT_MS / 1000);
        throw new Error(
          `SPARQL query timed out after ${seconds}s (after ${MAX_RETRIES} retries). ` +
            'The Cellar endpoint is slow for broad queries — narrow the search with resource_type, date_from/date_to, or a more specific query.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Builds a SPARQL SELECT query from the given parameters.
   */
  buildSparqlQuery(params: SparqlQueryParams): string {
    // The Cellar 3-letter code IS the language-authority URI suffix
    // (.../authority/language/POL etc.), so no mapping is needed here.
    const lang = params.language;
    const escaped = escapeSparqlString(params.query);

    const whereLines: string[] = [];

    // Resource type binding. When a specific type is requested we keep the filter
    // triple and BIND that exact type as ?resType — a work can carry several
    // resource-types, and re-deriving ?resType from a generic ?resTypeUri could
    // report a *different* type than the one filtered on. Only for 'any' do we
    // extract the type from the (single) ?resTypeUri binding.
    // params.resource_type is Zod-validated against RESOURCE_TYPES, so it is safe
    // to embed without escaping.
    if (params.resource_type !== 'any') {
      whereLines.push(
        `    ?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${params.resource_type}> .`,
        `    BIND("${params.resource_type}" AS ?resType)`,
      );
    } else {
      whereLines.push(
        '    ?work cdm:work_has_resource-type ?resTypeUri .',
        '    BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)',
      );
    }

    // CELEX identifier
    whereLines.push('    ?work cdm:resource_legal_id_celex ?celex .');

    // Expression and title (REQUIRED, not optional)
    whereLines.push(
      `    ?expr cdm:expression_belongs_to_work ?work .`,
      `    ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang}> .`,
      `    ?expr cdm:expression_title ?title .`,
    );

    // Date is OPTIONAL
    whereLines.push('    OPTIONAL { ?work cdm:work_date_document ?date . }');

    // Search filter on title
    whereLines.push(`    FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${escaped}")))`);

    // Date filters
    if (params.date_from) {
      whereLines.push(`    FILTER(?date >= "${params.date_from}"^^xsd:date)`);
    }
    if (params.date_to) {
      whereLines.push(`    FILTER(?date <= "${params.date_to}"^^xsd:date)`);
    }

    // No ORDER BY: `ORDER BY DESC(?date)` forces Virtuoso to materialize ALL
    // matching expressions before applying LIMIT — live-verified to time out for
    // broad title terms ("data protection", "Datenschutz"). Instead we oversample
    // (so Virtuoso can stream-abort early) and sort/dedup/slice client-side in
    // sparqlQuery(). Trade-off: results are "newest-first within the fetched
    // sample", not globally newest.
    const oversampledLimit = Math.min(params.limit * 3, 150);

    const query = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
      '',
      'SELECT DISTINCT ?work ?celex ?title ?date ?resType WHERE {',
      ...whereLines,
      '}',
      `LIMIT ${oversampledLimit}`,
    ].join('\n');

    return query;
  }

  /**
   * Executes a SPARQL query against the EU Publications Office endpoint.
   * Merges provided params with defaults before building and executing the query.
   */
  async sparqlQuery(
    query: string,
    params?: Partial<SparqlQueryParams>,
  ): Promise<{ results: SearchResult[]; sparql: string }> {
    const fullParams: SparqlQueryParams = {
      query,
      resource_type: params?.resource_type ?? 'any',
      language: params?.language ?? DEFAULT_LANGUAGE,
      limit: params?.limit ?? DEFAULT_LIMIT,
      date_from: params?.date_from,
      date_to: params?.date_to,
    };

    const sparql = this.buildSparqlQuery(fullParams);

    const data = await this.executeSparql<SparqlResponse>(sparql);
    const lang = fullParams.language;

    const results = data.results.bindings.map((binding) => {
      const celex = binding.celex.value;
      return {
        celex,
        title: binding.title.value,
        date: binding.date?.value ?? '',
        type: binding.resType.value,
        eurlex_url: `${EURLEX_BASE}/${LANGUAGE_ISO_MAP[lang] ?? DEFAULT_ISO}/TXT/?uri=CELEX:${celex}`,
      };
    });

    // The SPARQL query has no ORDER BY (see buildSparqlQuery) and oversamples the
    // LIMIT, so we sort here: date descending, with empty/missing dates last.
    // ISO date strings sort lexicographically = chronologically. Array.sort is
    // stable, so equal-date rows keep their original order.
    const sorted = [...results].sort((a, b) => {
      if (a.date === b.date) return 0;
      if (a.date === '') return 1;
      if (b.date === '') return -1;
      return a.date < b.date ? 1 : -1;
    });

    // Deduplicate by CELEX ID (same document can have multiple resource types).
    // After the date-desc sort, the first occurrence per CELEX is the newest.
    const seen = new Set<string>();
    const deduped = sorted.filter((r) => {
      if (seen.has(r.celex)) return false;
      seen.add(r.celex);
      return true;
    });

    // Slice back down to the caller's requested limit (we oversampled for the sort).
    const limited = deduped.slice(0, fullParams.limit);

    return { results: limited, sparql };
  }

  /**
   * Shared REST-GET logic for fetching a document from Cellar by CELEX identifier,
   * used by both fetchDocument() and fetchConsolidated(). Handles content negotiation
   * (Accept/Accept-Language), redirects, timeout, and 404/406/!ok status handling.
   * Retries on network errors, timeouts, and HTTP 5xx (never on 4xx).
   */
  private async fetchCellarDocument(
    celexId: string,
    language: string,
    context: { notFoundError: string; notAcceptableError: string },
  ): Promise<string> {
    const httpLang = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;
    const url = `${CELLAR_REST_BASE}/${celexId}`;

    return this.withRetry(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/xhtml+xml',
          'Accept-Language': httpLang,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 404) {
        throw new HttpStatusError(context.notFoundError, 404);
      }

      if (response.status === 406) {
        throw new HttpStatusError(context.notAcceptableError, 406);
      }

      if (!response.ok) {
        throw new HttpStatusError(`Fetch error: ${response.status}`, response.status);
      }

      return response.text();
    });
  }

  /**
   * Fetches a document from Cellar by CELEX identifier using content negotiation.
   * Uses Accept-Language header to select the language variant.
   */
  async fetchDocument(celex_id: string, language: string): Promise<string> {
    return this.fetchCellarDocument(celex_id, language, {
      notFoundError: `Document not found: ${celex_id}. The document may not be available in electronic full-text format on EUR-Lex.`,
      notAcceptableError: `Document ${celex_id} is not available in XHTML format. Older documents may only exist as PDF on EUR-Lex.`,
    });
  }

  /**
   * Builds a SPARQL query to retrieve metadata for a given CELEX ID.
   */
  buildMetadataQuery(celexId: string, language: string): string {
    // 3-letter code = language-authority URI suffix; ISO tag drives LANG() filters.
    const lang = language;
    const langLower = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;

    const query = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
      '',
      'SELECT ?title ?dateDoc ?dateForce ?dateEnd ?inForce ?dateTrans ?resType',
      '  (GROUP_CONCAT(DISTINCT ?authorName; separator="|||") AS ?authors)',
      '  (GROUP_CONCAT(DISTINCT ?evLabel; separator="|||") AS ?eurovoc)',
      '  (GROUP_CONCAT(DISTINCT ?dirCode; separator="|||") AS ?dirCodes)',
      '  (GROUP_CONCAT(DISTINCT ?basisCelex; separator="|||") AS ?legalBases)',
      'WHERE {',
      `  ?work cdm:resource_legal_id_celex ?celexVal .`,
      `  FILTER(STR(?celexVal) = "${escapeSparqlString(celexId)}")`,
      `  ?expr cdm:expression_belongs_to_work ?work .`,
      `  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang}> .`,
      `  ?expr cdm:expression_title ?title .`,
      '  OPTIONAL { ?work cdm:work_date_document ?dateDoc . }',
      '  OPTIONAL { ?work cdm:resource_legal_date_entry-into-force ?dateForce . }',
      '  OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?dateEnd . }',
      '  OPTIONAL { ?work cdm:resource_legal_in-force ?inForce . }',
      '  OPTIONAL { ?work cdm:resource_legal_date_transposition ?dateTrans . }',
      '  OPTIONAL {',
      '    ?work cdm:work_has_resource-type ?resTypeUri .',
      '    BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)',
      '  }',
      // Authors: the agent is an authority URI (e.g. .../corporate-body/EP) whose
      // human-readable name lives in skos:prefLabel — cdm:agent_name yields nothing
      // (verified: it was the cause of the always-empty authors). Prefer the
      // request-language label, fall back to English, last resort the URI tail.
      '  OPTIONAL {',
      '    ?work cdm:work_created_by_agent ?agent .',
      `    OPTIONAL { ?agent skos:prefLabel ?agentLabelLang . FILTER(LANG(?agentLabelLang) = "${langLower}") }`,
      '    OPTIONAL { ?agent skos:prefLabel ?agentLabelEn . FILTER(LANG(?agentLabelEn) = "en") }',
      '    BIND(COALESCE(?agentLabelLang, ?agentLabelEn, REPLACE(STR(?agent), "^.*/", "")) AS ?authorName)',
      '  }',
      '  OPTIONAL {',
      '    ?work cdm:work_is_about_concept_eurovoc ?evConcept .',
      '    ?evConcept skos:prefLabel ?evLabel .',
      `    FILTER(LANG(?evLabel) = "${langLower}")`,
      '  }',
      // Directory codes: emit "{code-tail}: {label}" (label in the request language),
      // or the bare code tail when no label exists. Code tail = URI fragment after '/'.
      '  OPTIONAL {',
      '    ?work cdm:resource_legal_is_about_concept_directory-code ?dirCodeUri .',
      '    BIND(REPLACE(STR(?dirCodeUri), "^.*/", "") AS ?dirTail)',
      `    OPTIONAL { ?dirCodeUri skos:prefLabel ?dirLabel . FILTER(LANG(?dirLabel) = "${langLower}") }`,
      '    BIND(IF(BOUND(?dirLabel), CONCAT(?dirTail, ": ", STR(?dirLabel)), ?dirTail) AS ?dirCode)',
      '  }',
      // Legal basis: the acts this act is based on, reported by their CELEX IDs.
      '  OPTIONAL {',
      '    ?work cdm:resource_legal_based_on_resource_legal ?basis .',
      '    ?basis cdm:resource_legal_id_celex ?basisCelex .',
      '  }',
      '}',
      'GROUP BY ?title ?dateDoc ?dateForce ?dateEnd ?inForce ?dateTrans ?resType',
    ].join('\n');

    return query;
  }

  /**
   * Fetches metadata for a CELEX ID from the SPARQL endpoint.
   */
  async metadataQuery(celexId: string, language: string): Promise<MetadataResult> {
    const cacheKey = `${celexId}|${language}`;
    const cached = this.metadataCache.get(cacheKey);
    // Shallow copy: the cache's stored object must never be the same reference
    // as anything handed to a caller, in either direction — otherwise a caller
    // mutating its result would silently corrupt what a later cache hit returns.
    if (cached !== undefined) return { ...cached };

    const sparql = this.buildMetadataQuery(celexId, language);

    const data = await this.executeSparql<MetadataSparqlResponse>(sparql);

    if (data.results.bindings.length === 0) {
      throw new Error(`No metadata found for CELEX: ${celexId}`);
    }

    const binding = data.results.bindings[0];
    const httpLang = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;

    const splitConcat = (value: string | undefined): string[] => {
      if (!value) return [];
      return value.split('|||').filter((s) => s !== '');
    };

    const parseInForce = (value: string | undefined): boolean | null => {
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      return null;
    };

    // Empty/missing date strings become null (not ''); the caller can then treat
    // "unknown" distinctly from a real date.
    const normalizeDate = (value: string | undefined): string | null => {
      return value ? value : null;
    };

    // Cellar uses 9999-12-31 as an "open-ended / no end of validity" sentinel.
    // Surfacing it as a real date is misleading, so collapse it (and empties) to null.
    const dateEnd = binding.dateEnd?.value;
    const dateEndNormalized = !dateEnd || dateEnd === '9999-12-31' ? null : dateEnd;

    const result: MetadataResult = {
      celex_id: celexId,
      title: binding.title?.value ?? '',
      date_document: normalizeDate(binding.dateDoc?.value),
      date_entry_into_force: normalizeDate(binding.dateForce?.value),
      date_end_of_validity: dateEndNormalized,
      in_force: parseInForce(binding.inForce?.value),
      date_transposition: normalizeDate(binding.dateTrans?.value),
      resource_type: binding.resType?.value ?? '',
      authors: splitConcat(binding.authors?.value),
      eurovoc_concepts: splitConcat(binding.eurovoc?.value),
      directory_codes: splitConcat(binding.dirCodes?.value),
      legal_basis: splitConcat(binding.legalBases?.value),
      eurlex_url: `${EURLEX_BASE}/${httpLang}/TXT/?uri=CELEX:${celexId}`,
    };

    this.metadataCache.set(cacheKey, { ...result });
    return result;
  }

  /**
   * Builds a SPARQL query to retrieve citations/relationships for a given CELEX ID.
   */
  buildCitationsQuery(
    celexId: string,
    language: string,
    direction: 'cites' | 'cited_by' | 'both',
    limit: number,
  ): string {
    // 3-letter code = language-authority URI suffix (no mapping needed).
    const lang = language;
    const escaped = escapeSparqlString(celexId);

    // Use FILTER(STR(...)) for CELEX matching — literals may be typed as xsd:string
    const sourceFilter = `    ?sourceWork cdm:resource_legal_id_celex ?srcCelex .\n    FILTER(STR(?srcCelex) = "${escaped}")`;

    const citesBlock = [
      '  {',
      sourceFilter,
      '    { ?sourceWork cdm:work_cites_work ?relWork . BIND("cites" AS ?rel) }',
      '    UNION',
      '    { ?sourceWork cdm:resource_legal_based_on_resource_legal ?relWork . BIND("based_on" AS ?rel) }',
      '    UNION',
      '    { ?sourceWork cdm:resource_legal_amends_resource_legal ?relWork . BIND("amends" AS ?rel) }',
      '    UNION',
      '    { ?sourceWork cdm:resource_legal_repeals_resource_legal ?relWork . BIND("repeals" AS ?rel) }',
      '  }',
    ].join('\n');

    const citedByBlock = [
      '  {',
      `    ?relWork cdm:work_cites_work ?sourceWork .`,
      sourceFilter,
      '    BIND("cited_by" AS ?rel)',
      '  }',
      '  UNION',
      '  {',
      `    ?relWork cdm:resource_legal_based_on_resource_legal ?sourceWork .`,
      sourceFilter,
      '    BIND("basis_for" AS ?rel)',
      '  }',
      '  UNION',
      '  {',
      `    ?relWork cdm:resource_legal_amends_resource_legal ?sourceWork .`,
      sourceFilter,
      '    BIND("amended_by" AS ?rel)',
      '  }',
      '  UNION',
      '  {',
      `    ?relWork cdm:resource_legal_repeals_resource_legal ?sourceWork .`,
      sourceFilter,
      '    BIND("repealed_by" AS ?rel)',
      '  }',
    ].join('\n');

    let body: string;
    if (direction === 'cites') body = citesBlock;
    else if (direction === 'cited_by') body = citedByBlock;
    else body = `${citesBlock}\n  UNION\n${citedByBlock}`;

    return [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      '',
      'SELECT DISTINCT ?celex ?title ?date ?resType ?rel WHERE {',
      body,
      '  ?relWork cdm:resource_legal_id_celex ?celex .',
      '  ?relWork cdm:work_has_resource-type ?resTypeUri .',
      '  BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)',
      `  ?relExpr cdm:expression_belongs_to_work ?relWork .`,
      `  ?relExpr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang}> .`,
      '  ?relExpr cdm:expression_title ?title .',
      '  OPTIONAL { ?relWork cdm:work_date_document ?date . }',
      '}',
      'ORDER BY DESC(?date)',
      `LIMIT ${limit}`,
    ].join('\n');
  }

  /**
   * Runs one directional citations query and parses its bindings into entries.
   */
  private async fetchCitationEntries(
    celexId: string,
    language: string,
    direction: 'cites' | 'cited_by',
    limit: number,
  ): Promise<CitationEntry[]> {
    const httpLang = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;
    const sparql = this.buildCitationsQuery(celexId, language, direction, limit);
    const data = await this.executeSparql<CitationsSparqlResponse>(sparql);

    return data.results.bindings.map((b) => {
      const rel = b.rel.value;
      if (!VALID_RELATIONSHIPS.has(rel as CitationEntry['relationship'])) {
        throw new Error(`Unexpected relationship value from SPARQL: ${rel}`);
      }
      return {
        celex: b.celex.value,
        title: b.title.value,
        date: b.date?.value ?? '',
        type: b.resType.value,
        relationship: rel as CitationEntry['relationship'],
        eurlex_url: `${EURLEX_BASE}/${httpLang}/TXT/?uri=CELEX:${b.celex.value}`,
      };
    });
  }

  /**
   * Fetches citations/relationships for a CELEX ID from the SPARQL endpoint.
   *
   * For `both`, the two directions are queried separately (each with roughly half
   * the limit) and run in parallel. A single combined UNION query ordered by date
   * lets recent `cited_by` rows crowd out the `cites` side entirely — live-verified.
   * Splitting guarantees a balanced result. `cites`-side entries are listed first.
   */
  async citationsQuery(
    celexId: string,
    language: string,
    direction: 'cites' | 'cited_by' | 'both',
    limit: number,
  ): Promise<CitationsResult> {
    let citations: CitationEntry[];

    if (direction === 'both') {
      const [citesEntries, citedByEntries] = await Promise.all([
        this.fetchCitationEntries(celexId, language, 'cites', Math.ceil(limit / 2)),
        this.fetchCitationEntries(celexId, language, 'cited_by', Math.floor(limit / 2)),
      ]);
      // cites-side first, then cited_by-side
      citations = [...citesEntries, ...citedByEntries];
    } else {
      citations = await this.fetchCitationEntries(celexId, language, direction, limit);
    }

    // counts classify by relationship, so they stay correct for every direction.
    const cites = citations.filter((c) => CITES_SIDE_RELATIONSHIPS.has(c.relationship)).length;

    return {
      celex_id: celexId,
      citations,
      total: citations.length,
      counts: { cites, cited_by: citations.length - cites },
    };
  }

  /**
   * Maps the `court` enum to the CDM corporate-body authority code that authors
   * the ruling (`cdm:work_created_by_agent`). Live-verified 2026-07-05:
   * Court of Justice rulings carry `.../corporate-body/CJ`, General Court rulings
   * `.../corporate-body/GCEU`. Keys are exactly the non-"any" `COURTS` enum values.
   */
  private static readonly COURT_AGENT_MAP: Record<string, string> = {
    COURT_JUSTICE: 'CJ',
    GENERAL_COURT: 'GCEU',
  };

  /**
   * Builds a SPARQL SELECT for CJEU case law. The four primary inputs (query,
   * celex_id, ecli, related_celex) act as AND constraints and may be combined;
   * the calling schema guarantees at least one is present.
   *
   * Case law is delimited by sector 6 (`resource_legal_id_sector "6"`), the CDM
   * "case law" sector — probed 2026-07-05. `related_celex` uses the precise
   * `cdm:case-law_interpretes_resource_legal` relation (case law that *interprets*
   * the act, 72 works for the GDPR) rather than the broader `work_cites_work`
   * (334 works, any mention). The `court` dimension maps to the authoring
   * corporate body (CJ / GCEU); `type` to the case-law resource-type.
   *
   * ORDER BY policy mirrors the timeout learnings: a title-only `query` scan is a
   * broad title-substring search (like sparqlQuery) — NO ORDER BY, oversample and
   * sort client-side. Any of celex_id/ecli/related_celex anchors the query to a
   * small result set, where ORDER BY DESC(?date) is safe. We oversample the LIMIT
   * in both cases so the client-side dedup-by-CELEX (a work can carry several
   * resource-types) cannot drop the result count below the requested `limit`.
   */
  buildCaseLawQuery(params: CaseLawQueryParams): string {
    // params.language / params.type / params.court are Zod-validated enums; user
    // free-text (query, celex_id, ecli, related_celex) only enters via
    // escapeSparqlString. The 3-letter language code IS the language-URI suffix.
    const lang = params.language;

    const whereLines: string[] = [];

    // Resource type (case-law procedure type). Same rationale as buildSparqlQuery:
    // BIND the exact filtered type as ?resType so a multi-type work cannot report
    // a different type than the one filtered on; for 'any' derive it from the URI.
    if (params.type !== 'any') {
      whereLines.push(
        `    ?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${params.type}> .`,
        `    BIND("${params.type}" AS ?resType)`,
      );
    } else {
      whereLines.push(
        '    ?work cdm:work_has_resource-type ?resTypeUri .',
        '    BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)',
      );
    }

    // Restrict to the case-law sector. STR()-compare because the sector literal is
    // typed xsd:string, which a plain "6" literal does not match in Virtuoso.
    whereLines.push(
      '    ?work cdm:resource_legal_id_sector ?sector .',
      '    FILTER(STR(?sector) = "6")',
    );

    // CELEX identifier (always selected).
    whereLines.push('    ?work cdm:resource_legal_id_celex ?celex .');
    if (params.celex_id) {
      whereLines.push(`    FILTER(STR(?celex) = "${escapeSparqlString(params.celex_id)}")`);
    }

    // ECLI: anchor on it when provided, otherwise fetch it optionally for output.
    if (params.ecli) {
      whereLines.push(
        '    ?work cdm:case-law_ecli ?ecli .',
        `    FILTER(STR(?ecli) = "${escapeSparqlString(params.ecli)}")`,
      );
    } else {
      whereLines.push('    OPTIONAL { ?work cdm:case-law_ecli ?ecli . }');
    }

    // Case law interpreting a given legal act.
    if (params.related_celex) {
      whereLines.push(
        '    ?act cdm:resource_legal_id_celex ?actCelex .',
        `    FILTER(STR(?actCelex) = "${escapeSparqlString(params.related_celex)}")`,
        '    ?work cdm:case-law_interpretes_resource_legal ?act .',
      );
    }

    // Court filter via the authoring corporate body. params.court is a validated
    // enum, its mapped code is a fixed constant — safe to embed.
    if (params.court !== 'any') {
      const agent = CellarClient.COURT_AGENT_MAP[params.court];
      whereLines.push(
        `    ?work cdm:work_created_by_agent <http://publications.europa.eu/resource/authority/corporate-body/${agent}> .`,
      );
    }

    // Title (REQUIRED) in the requested language.
    whereLines.push(
      '    ?expr cdm:expression_belongs_to_work ?work .',
      `    ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang}> .`,
      '    ?expr cdm:expression_title ?title .',
    );

    // Date is OPTIONAL.
    whereLines.push('    OPTIONAL { ?work cdm:work_date_document ?date . }');

    // Title substring filter.
    if (params.query) {
      whereLines.push(
        `    FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${escapeSparqlString(params.query)}")))`,
      );
    }

    // Date filters.
    if (params.date_from) {
      whereLines.push(`    FILTER(?date >= "${params.date_from}"^^xsd:date)`);
    }
    if (params.date_to) {
      whereLines.push(`    FILTER(?date <= "${params.date_to}"^^xsd:date)`);
    }

    const hasNarrowAnchor = Boolean(params.celex_id || params.ecli || params.related_celex);
    const oversampledLimit = Math.min(params.limit * 3, 150);

    const lines = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
      '',
      'SELECT DISTINCT ?work ?celex ?ecli ?title ?date ?resType WHERE {',
      ...whereLines,
      '}',
    ];
    // ORDER BY only for anchored (small) result sets — see method doc.
    if (hasNarrowAnchor) {
      lines.push('ORDER BY DESC(?date)');
    }
    lines.push(`LIMIT ${oversampledLimit}`);

    return lines.join('\n');
  }

  /**
   * Executes a case-law query and returns deduplicated, date-sorted results.
   * The same client-side pipeline as sparqlQuery: sort date-desc (empty dates
   * last), dedup by CELEX (a work can carry multiple resource-types), slice to
   * the requested limit (the SPARQL LIMIT was oversampled).
   */
  async caseLawQuery(params: CaseLawQueryParams): Promise<CaseLawResult> {
    const sparql = this.buildCaseLawQuery(params);
    const data = await this.executeSparql<CaseLawSparqlResponse>(sparql);
    const httpLang = LANGUAGE_ISO_MAP[params.language] ?? DEFAULT_ISO;

    const entries: CaseLawEntry[] = data.results.bindings.map((b) => ({
      celex: b.celex.value,
      ecli: b.ecli?.value ?? '',
      title: b.title.value,
      date: b.date?.value ?? '',
      type: b.resType.value,
      eurlex_url: `${EURLEX_BASE}/${httpLang}/TXT/?uri=CELEX:${b.celex.value}`,
    }));

    // Date descending, empty/missing dates last. Array.sort is stable, so equal
    // dates keep their original (query) order. ISO dates sort chronologically.
    const sorted = [...entries].sort((a, b) => {
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

    const limited = deduped.slice(0, params.limit);
    return { results: limited, total: limited.length };
  }

  /**
   * Resolves a EuroVoc label to its concept URI via a lightweight SPARQL query.
   * Returns null if no matching concept is found.
   *
   * Precision: labels are filtered to the request language, and results are ordered
   * so an exact (case-insensitive) label match wins over a mere substring match, then
   * the shortest label — a deterministic single winner instead of an arbitrary one.
   */
  async resolveEurovocLabel(label: string, language: string): Promise<string | null> {
    const cacheKey = `${label.toLowerCase()}|${language}`;
    const cached = this.eurovocLabelCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const escaped = escapeSparqlString(label);
    const langLower = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;

    const sparql = [
      'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
      'SELECT ?concept WHERE {',
      '  ?concept a skos:Concept .',
      '  ?concept skos:prefLabel ?label .',
      `  FILTER(STRSTARTS(STR(?concept), "http://eurovoc.europa.eu/"))`,
      `  FILTER(LANG(?label) = "${langLower}")`,
      `  FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${escaped}")))`,
      '}',
      `ORDER BY DESC(LCASE(STR(?label)) = LCASE("${escaped}")) STRLEN(STR(?label))`,
      'LIMIT 1',
    ].join('\n');

    const data = await this.executeSparql<{
      results: { bindings: { concept: { value: string } }[] };
    }>(sparql);
    const bindings = data.results.bindings;
    // null means "the query succeeded and found no matching concept" — a real
    // legitimate "not found". Network/timeout/5xx errors propagate to the caller
    // instead of being swallowed here (and are never cached, see below).
    const result = bindings.length > 0 ? bindings[0].concept.value : null;
    this.eurovocLabelCache.set(cacheKey, result);
    return result;
  }

  /**
   * Builds a SPARQL query to find EU legal acts by EuroVoc concept URI.
   * Only accepts a direct EuroVoc URI — label resolution must be done beforehand
   * via resolveEurovocLabel().
   */
  buildEurovocQuery(
    conceptUri: string,
    resourceType: string,
    language: string,
    limit: number,
  ): string {
    // 3-letter code = language-authority URI suffix (no mapping needed).
    const lang = language;

    // Only accept URIs
    if (!conceptUri.startsWith('http')) {
      throw new Error(
        `Invalid concept: expected a URI starting with http, got "${conceptUri}". Use resolveEurovocLabel() first.`,
      );
    }

    // Reject angle brackets — they can break SPARQL IRI syntax
    if (/[<>]/.test(conceptUri)) {
      throw new Error(`Invalid URI: contains characters not allowed in SPARQL IRIs`);
    }

    if (/[\s"{}|\\^`]/.test(conceptUri)) {
      throw new Error(`Invalid URI: contains characters not allowed in SPARQL IRIs`);
    }

    const conceptFilter = `  ?work cdm:work_is_about_concept_eurovoc <${conceptUri}> .`;

    const typeFilter =
      resourceType !== 'any'
        ? `  ?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${resourceType}> .`
        : '';

    return [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
      '',
      'SELECT DISTINCT ?work ?celex ?title ?date ?resType WHERE {',
      conceptFilter,
      typeFilter,
      '  ?work cdm:resource_legal_id_celex ?celex .',
      '  ?work cdm:work_has_resource-type ?resTypeUri .',
      '  BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)',
      `  ?expr cdm:expression_belongs_to_work ?work .`,
      `  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang}> .`,
      '  ?expr cdm:expression_title ?title .',
      '  OPTIONAL { ?work cdm:work_date_document ?date . }',
      `  FILTER NOT EXISTS { ?work cdm:do_not_index "true"^^xsd:boolean }`,
      '}',
      'ORDER BY DESC(?date)',
      `LIMIT ${limit}`,
    ].join('\n');
  }

  /**
   * Executes a EuroVoc concept query against the SPARQL endpoint and returns search results.
   * For label-based concepts, first resolves the label to a URI via a lightweight query.
   */
  async eurovocQuery(
    concept: string,
    resourceType: string,
    language: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const isUri = concept.startsWith('http');
    let conceptUri: string;

    if (isUri) {
      conceptUri = concept;
    } else {
      const resolved = await this.resolveEurovocLabel(concept, language);
      if (resolved === null) {
        return [];
      }
      conceptUri = resolved;
    }

    const sparql = this.buildEurovocQuery(conceptUri, resourceType, language, limit);
    const httpLang = LANGUAGE_ISO_MAP[language] ?? DEFAULT_ISO;

    const data = await this.executeSparql<SparqlResponse>(sparql);
    return data.results.bindings.map((b) => ({
      celex: b.celex.value,
      title: b.title.value,
      date: b.date?.value ?? '',
      type: b.resType.value,
      eurlex_url: `${EURLEX_BASE}/${httpLang}/TXT/?uri=CELEX:${b.celex.value}`,
    }));
  }

  /**
   * Resolves a document identifier to its CELEX ID. Exactly one of `celex_id`,
   * `eli`, or `oj_ref` is expected (the calling tool schema enforces the XOR via
   * superRefine before this runs). A `celex_id` is returned as-is with no network
   * call; `eli`/`oj_ref` are looked up against Cellar SPARQL.
   */
  async resolveCelexId(input: {
    celex_id?: string;
    eli?: string;
    oj_ref?: string;
  }): Promise<string> {
    if (input.celex_id !== undefined) return input.celex_id;
    if (input.eli !== undefined) return this.resolveEliToCelex(input.eli);
    if (input.oj_ref !== undefined) return this.resolveOjRefToCelex(input.oj_ref);
    throw new Error('No identifier provided. Give one of: celex_id, eli, or oj_ref.');
  }

  /**
   * Resolves an ELI (full URL or short `type/year/number`) to its CELEX ID via
   * SPARQL. ELI is stored as the typed literal `cdm:resource_legal_eli`
   * (xsd:anyURI) — matched with FILTER(STR(...)) exactly as the metadata/citations
   * queries match CELEX literals. Probed 2026-07-05: GDPR ELI resolves to
   * 32016R0679, AI Act ELI to 32024R1689.
   *
   * @throws with example ELI formats when the ELI is malformed or unresolvable.
   */
  async resolveEliToCelex(eli: string): Promise<string> {
    const canonical = normalizeEliToCanonicalUri(eli);

    const sparql = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'SELECT ?celex WHERE {',
      '  ?work cdm:resource_legal_eli ?eli .',
      `  FILTER(STR(?eli) = "${escapeSparqlString(canonical)}")`,
      '  ?work cdm:resource_legal_id_celex ?celex .',
      '}',
      'LIMIT 1',
    ].join('\n');

    const data = await this.executeSparql<{
      results: { bindings: { celex: { value: string } }[] };
    }>(sparql);

    const bindings = data.results.bindings;
    if (bindings.length === 0) {
      throw new Error(
        `Could not resolve ELI "${eli}" (${canonical}) to a CELEX ID: no matching EU act found. ` +
          'Examples: "reg/2016/679" (GDPR), "dir/2022/2555" (NIS2).',
      );
    }
    return bindings[0].celex.value;
  }

  /**
   * Resolves an OJ reference in the post-2023 scheme (e.g. "OJ:L_202401689") to
   * its CELEX ID via SPARQL. The work is linked to the OJ resource URI through
   * `owl:sameAs` (probed 2026-07-05: L_202401689 -> 32024R1689, unique). The OJ
   * reference alone cannot yield the CELEX arithmetically — its "L" is the OJ
   * series, not the R/L/D act type — so this lookup is mandatory.
   *
   * @throws with an example OJ format when the reference is malformed or unresolvable.
   */
  async resolveOjRefToCelex(ojRef: string): Promise<string> {
    // normalizeOjRefToResourceUri only emits [A-Za-z0-9_] in the id, so the URI is
    // IRI-safe and embeds directly (like the validated URIs in buildEurovocQuery).
    const ojUri = normalizeOjRefToResourceUri(ojRef);

    const sparql = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      'PREFIX owl: <http://www.w3.org/2002/07/owl#>',
      'SELECT ?celex WHERE {',
      `  ?work owl:sameAs <${ojUri}> .`,
      '  ?work cdm:resource_legal_id_celex ?celex .',
      '}',
      'LIMIT 1',
    ].join('\n');

    const data = await this.executeSparql<{
      results: { bindings: { celex: { value: string } }[] };
    }>(sparql);

    const bindings = data.results.bindings;
    if (bindings.length === 0) {
      throw new Error(
        `Could not resolve OJ reference "${ojRef}" (${ojUri}) to a CELEX ID: no matching EU act found. ` +
          'Example: "OJ:L_202401689" (AI Act).',
      );
    }
    return bindings[0].celex.value;
  }

  /** Maps doc_type (reg/dir/dec) to CELEX type letter (R/L/D) */
  private static readonly DOC_TYPE_CELEX_MAP: Record<string, string> = {
    reg: 'R',
    dir: 'L',
    dec: 'D',
  };

  /**
   * Finds the consolidated CELEX ID for a given document via SPARQL.
   * Consolidated CELEX IDs have prefix 0, e.g. 02024R1689-20240712.
   */
  async findConsolidatedCelex(
    docType: string,
    year: number,
    number: number,
  ): Promise<string | null> {
    const cacheKey = `${docType}/${year}/${number}`;
    const cached = this.consolidatedCelexCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const typeLetter = CellarClient.DOC_TYPE_CELEX_MAP[docType] ?? 'R';
    const celexBody = `0${year}${typeLetter}${String(number).padStart(4, '0')}`;

    // Anchored regex instead of a bare STRSTARTS prefix: a 4-digit number like
    // 0679 must NOT match a longer document number (e.g. 06791). The consolidated
    // CELEX is either the bare body or the body plus a "-YYYYMMDD" consolidation
    // date suffix. year/typeLetter/number are Zod-validated numbers/enums (not
    // user-controlled free text), so no escaping is required.
    const celexRegex = `^${celexBody}(-[0-9]{8})?$`;

    const sparql = [
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>',
      `SELECT ?celex WHERE {`,
      `  ?work cdm:resource_legal_id_celex ?celex .`,
      `  FILTER(REGEX(STR(?celex), "${celexRegex}"))`,
      `}`,
      // Invariant: the "-YYYYMMDD" suffix sorts lexicographically, so the largest
      // CELEX IS the newest consolidation. DESC + LIMIT 1 returns exactly that.
      `ORDER BY DESC(?celex)`,
      `LIMIT 1`,
    ].join('\n');

    const data = await this.executeSparql<{
      results: { bindings: { celex: { value: string } }[] };
    }>(sparql);
    // null is a legitimate "no consolidated version found" result — cached just
    // like a hit, since re-querying would just re-confirm the same absence.
    const result = data.results.bindings.length > 0 ? data.results.bindings[0].celex.value : null;
    this.consolidatedCelexCache.set(cacheKey, result);
    return result;
  }

  /**
   * Fetches the consolidated (currently applicable) version of an EU legal act.
   * Step 1: Find consolidated CELEX ID via SPARQL.
   * Step 2: Fetch document from Cellar REST (same endpoint as fetchDocument).
   */
  async fetchConsolidated(
    docType: string,
    year: number,
    number: number,
    language: string,
  ): Promise<{ content: string; eliUrl: string; consolidatedCelex: string }> {
    // Step 1: Find consolidated CELEX ID
    const consolidatedCelex = await this.findConsolidatedCelex(docType, year, number);

    if (!consolidatedCelex) {
      throw new Error(
        `No consolidated version available for ${docType}/${year}/${number}. ` +
          'Use eurlex_fetch with the CELEX ID for the original OJ version.',
      );
    }

    // Step 2: Fetch from Cellar REST via the shared helper (same as fetchDocument)
    const content = await this.fetchCellarDocument(consolidatedCelex, language, {
      notFoundError:
        `No consolidated version available for ${docType}/${year}/${number} (${consolidatedCelex} could not be retrieved). ` +
        'Use eurlex_fetch with the CELEX ID for the original OJ version.',
      notAcceptableError: `Consolidated document ${consolidatedCelex} is not available in XHTML format. Older documents may only exist as PDF on EUR-Lex.`,
    });

    const eliUrl = `http://data.europa.eu/eli/${docType}/${year}/${number}`;
    return { content, eliUrl, consolidatedCelex };
  }
}

/**
 * Shared singleton instance used by all tool handlers, so the instance-level
 * caches (EuroVoc label resolution, consolidated CELEX lookups, metadata) are
 * actually shared across requests within one process — a fresh `new
 * CellarClient()` per call would make the caching above pointless.
 */
export const sharedCellarClient = new CellarClient();
