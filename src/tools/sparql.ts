import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  SPARQL_DEFAULT_LIMIT,
  SPARQL_MAX_LIMIT,
  SPARQL_RESPONSE_CHAR_BUDGET,
} from '../constants.js';
import { sparqlSchema } from '../schemas/sparqlSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { SparqlRawResult } from '../types.js';
import { toolError } from '../utils.js';

/**
 * SPARQL Update operations and the federated-query keyword we refuse. The endpoint
 * is public and read-only, so this is about fairness (no write attempts hammering
 * the endpoint) and blocking SSRF-style federation (SERVICE points Cellar at an
 * attacker-chosen endpoint) — NOT data security. Matched as whole words,
 * case-insensitively, against the query with strings/comments/IRIs removed.
 */
const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'DELETE',
  'LOAD',
  'CLEAR',
  'CREATE',
  'DROP',
  'COPY',
  'MOVE',
  'ADD',
  'SERVICE',
] as const;

const FORBIDDEN_RE = new RegExp(`\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

/** The four SPARQL query forms; only SELECT/ASK are permitted. */
const QUERY_FORM_RE = /\b(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i;

/**
 * One regex that matches, in precedence order, a SPARQL token whose contents must
 * NOT be scanned for keywords or braces: triple-quoted strings, single-line
 * strings, an IRIREF, or a line comment. Ordering matters — string forms come
 * before the comment rule so a "#" inside a literal is not read as a comment, and
 * the IRIREF rule (before the comment rule) is why "#" inside `<...cdm#>` is not a
 * comment either. The IRIREF char class approximates the SPARQL grammar's: it
 * forbids whitespace (\s) and `<>"{}|^`\`. Forbidding whitespace is the load-bearing
 * part — the `<` / `<=` comparison operators (always followed by whitespace or an
 * expression) do NOT match as an IRIREF, and an IRIREF match can never span the
 * whitespace separating a keyword like SERVICE, so scrubbing never hides a live
 * keyword. (The grammar also excludes sub-space control chars, which never occur in
 * a real query; \s omits them, which also satisfies the no-control-regex lint.)
 */
const SCRUB_TOKEN_RE =
  /'''(?:\\.|[^\\])*?'''|"""(?:\\.|[^\\])*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|<[^<>"{}|^`\\\s]*>|#[^\n]*/g;

/**
 * Returns the query with every string literal, line comment and IRIREF replaced by
 * a single space. Whole-word keyword detection and brace-depth counting then run on
 * the result, so a keyword or brace that only appears inside a literal/comment/IRI
 * is ignored. This is why a legitimate query with the word "DELETE" inside a title
 * FILTER string is accepted while an actual DELETE operation is not.
 *
 * Honesty about limits (per the task brief): for a WELL-FORMED query this matches
 * the SPARQL grammar's own tokenization, so it never *under*-blocks (never hides a
 * live keyword). It can *over*-block in rare edge cases — e.g. a PREFIX literally
 * named `service:`, or a variable named `?add` — which the brief deems acceptable.
 * A malformed query (e.g. an unterminated string) is a SPARQL syntax error the
 * endpoint rejects regardless, so a mis-scrub there executes nothing.
 */
export function scrubSparql(query: string): string {
  return query.replace(SCRUB_TOKEN_RE, ' ');
}

/**
 * Finds the value of the query's TOP-LEVEL (brace-depth 0) LIMIT, or null when the
 * query has none. A LIMIT inside a subquery lives at depth >= 1 and is deliberately
 * ignored: the policy caps only the outer result the caller receives. When several
 * depth-0 LIMITs appear (not valid SPARQL, but be defensive) the last one wins.
 * Braces only occur as SPARQL group delimiters in the scrubbed text (IRIs/strings,
 * the only other place `{}` could appear, are already removed), so the count is exact.
 */
function findTopLevelLimit(scrubbed: string): number | null {
  const re = /\{|\}|\bLIMIT\b\s+(\d+)/gi;
  let depth = 0;
  let value: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scrubbed)) !== null) {
    if (match[0] === '{') depth++;
    else if (match[0] === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) value = Number(match[1]);
  }
  return value;
}

/**
 * Validates a raw SPARQL query against the read-only policy and normalizes its
 * LIMIT, returning the query to actually execute. Throws an Error with a clear,
 * user-facing message on any rejection (the handler turns it into a tool error).
 *
 * Policy:
 *  - reject any forbidden keyword (SPARQL Update or SERVICE);
 *  - accept only SELECT or ASK query forms (CONSTRUCT/DESCRIBE rejected);
 *  - for SELECT: append `LIMIT {default}` when there is no top-level LIMIT, and
 *    reject a top-level LIMIT above the maximum. ASK takes no LIMIT, so it is
 *    passed through untouched.
 */
export function validateAndPrepareSparql(query: string): { query: string; limitAdded: boolean } {
  const scrubbed = scrubSparql(query);

  const forbidden = FORBIDDEN_RE.exec(scrubbed);
  if (forbidden) {
    throw new Error(
      `Query rejected: the keyword "${forbidden[0].toUpperCase()}" is not allowed. ` +
        'eurlex_sparql is read-only — SPARQL Update (INSERT/DELETE/LOAD/CLEAR/CREATE/DROP/' +
        'COPY/MOVE/ADD) and federated SERVICE clauses are blocked. ' +
        '(A blocked word inside a string literal or comment is ignored and is not the cause.)',
    );
  }

  const form = QUERY_FORM_RE.exec(scrubbed);
  const formKeyword = form ? form[1].toUpperCase() : null;
  if (formKeyword !== 'SELECT' && formKeyword !== 'ASK') {
    throw new Error(
      'Query rejected: eurlex_sparql only accepts SELECT or ASK queries' +
        (formKeyword ? ` (got ${formKeyword})` : ' (no query form found)') +
        '. CONSTRUCT, DESCRIBE and update operations are not supported.',
    );
  }

  // ASK returns a single boolean and takes no solution modifier — pass it through.
  if (formKeyword === 'ASK') {
    return { query, limitAdded: false };
  }

  const topLimit = findTopLevelLimit(scrubbed);
  if (topLimit !== null) {
    if (topLimit > SPARQL_MAX_LIMIT) {
      throw new Error(
        `Query rejected: LIMIT ${topLimit} exceeds the maximum of ${SPARQL_MAX_LIMIT}. ` +
          `Lower the top-level LIMIT to ${SPARQL_MAX_LIMIT} or fewer rows.`,
      );
    }
    return { query, limitAdded: false };
  }

  return { query: `${query.trimEnd()}\nLIMIT ${SPARQL_DEFAULT_LIMIT}`, limitAdded: true };
}

/**
 * Drops whole binding rows from the end until the serialized array fits the char
 * budget. Whole-row (never mid-row) truncation keeps every returned row a valid,
 * complete SPARQL binding. `truncated` reports whether any rows were dropped.
 */
function truncateBindings(bindings: unknown[]): { included: unknown[]; truncated: boolean } {
  if (JSON.stringify(bindings).length <= SPARQL_RESPONSE_CHAR_BUDGET) {
    return { included: bindings, truncated: false };
  }
  const included: unknown[] = [];
  let size = 2; // the enclosing "[]"
  for (const row of bindings) {
    const rowSize = JSON.stringify(row).length + 1; // +1 for the "," separator
    if (size + rowSize > SPARQL_RESPONSE_CHAR_BUDGET) break;
    included.push(row);
    size += rowSize;
  }
  return { included, truncated: true };
}

/** Minimal view of a SPARQL 1.1 JSON result — the fields the tool reshapes. */
interface RawSparqlJson {
  head?: { vars?: string[] };
  results?: { bindings?: unknown[] };
  boolean?: boolean;
}

/** Reshapes a raw SPARQL JSON result into the tool's SparqlRawResult (see types.ts). */
export function shapeSparqlResult(raw: unknown, limitAdded: boolean): SparqlRawResult {
  const json = (raw ?? {}) as RawSparqlJson;

  // ASK → a single boolean, no rows.
  if (typeof json.boolean === 'boolean') {
    return { row_count: null, returned_rows: null, truncated: false, boolean: json.boolean };
  }

  const bindings = Array.isArray(json.results?.bindings) ? json.results.bindings : [];
  const { included, truncated } = truncateBindings(bindings);

  const result: SparqlRawResult = {
    row_count: bindings.length,
    returned_rows: included.length,
    truncated,
    bindings: included,
  };
  if (json.head?.vars) result.vars = json.head.vars;
  if (limitAdded) result.limit_added = true;
  return result;
}

export async function handleEurlexSparql(input: {
  query: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const { query, limitAdded } = validateAndPrepareSparql(input.query);
    const raw = await sharedCellarClient.executeRawSparql(query);
    const result = shapeSparqlResult(raw, limitAdded);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    return toolError(error);
  }
}

export function registerSparqlTool(server: McpServer): void {
  server.tool(
    'eurlex_sparql',
    'Expert escape hatch: run a raw, read-only SPARQL 1.1 query directly against the EU Publications Office (Cellar) endpoint when the higher-level tools (eurlex_search, eurlex_metadata, eurlex_citations, eurlex_case_law, eurlex_transposition, eurlex_summary, …) cannot express what you need. Requires knowledge of the CDM ontology — READ THE eurlex_guide PROMPT FIRST for the property cheat sheet (celex, title, language, dates, citations, case law, transposition, summaries). Only SELECT and ASK are allowed; SPARQL Update (INSERT/DELETE/…) and federated SERVICE clauses are rejected before the query is sent. A SELECT with no top-level LIMIT gets LIMIT 50 appended (set limit_added); a top-level LIMIT above 100 is rejected. The response mirrors SPARQL JSON — vars + bindings for SELECT, boolean for ASK — plus row_count and a truncated flag (whole rows are dropped past ~40k characters). CELEX/ELI literals are typed xsd:string, so match them with FILTER(STR(?x) = "..."). Example: PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT ?celex WHERE { ?w cdm:resource_legal_id_celex ?celex . FILTER(STR(?celex) = "32016R0679") } LIMIT 1',
    sparqlSchema.shape,
    {
      title: 'Run a raw read-only SPARQL query',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexSparql(params),
  );
}
