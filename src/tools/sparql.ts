import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  SPARQL_DEFAULT_LIMIT,
  SPARQL_MAX_LIMIT,
  SPARQL_RESPONSE_CHAR_BUDGET,
} from '../constants.js';
import { sparqlSchema, sparqlOutputSchema } from '../schemas/sparqlSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { SparqlRawResult, ToolResult } from '../types.js';
import { toCallToolResult, toolError } from '../utils.js';

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
 * NOT be scanned for keywords or braces: a backslash-escape, triple-quoted strings,
 * single-line strings, an IRIREF, or a line comment.
 *
 * The FIRST alternative (`\\[\s\S]`) is the load-bearing fix for the PN_LOCAL_ESC
 * bypass. SPARQL's PN_LOCAL_ESC production lets a prefixed local name contain a
 * backslash-escaped char (`\_ ~ . - ! $ & ' ( ) * + , ; = / ? # @ %`), e.g.
 * `ex:a\#b`. Without modelling that, the stray backslash falls through and the
 * following `#`/`'`/`"` opens a comment/string that swallows the rest of the line —
 * INCLUDING a live SERVICE clause — so the forbidden query reaches the endpoint
 * (an UNDER-block, since validateAndPrepareSparql sends the ORIGINAL text). By
 * consuming any `\<char>` atomically FIRST (replaced by a space), the escaped char
 * can no longer start a token.
 *
 * Why this introduces no new bypass (never a NEW under-block): `.replace(/g)` scans
 * left-to-right and resumes after each match, so this alternative can only fire on a
 * backslash that is NOT already inside a previously-matched token. A backslash
 * inside a string literal is never reached at top level — the string alternatives
 * are tried at the opening quote (encountered first) and consume the whole literal,
 * including their own interior `\.` escapes. So `\<char>` fires only on backslashes
 * OUTSIDE strings — exactly the PN_LOCAL_ESC (and UCHAR) positions — and consumes
 * exactly two chars. It cannot carve a live keyword: no forbidden keyword contains
 * or starts with a backslash, and a backslash sitting immediately before a keyword
 * is not well-formed SPARQL (a syntax error the endpoint rejects, so nothing runs).
 * Trace `\"SELECT…SERVICE…"`: the `\"` is eaten, the quote never opens a string, and
 * the now-bare SELECT/SERVICE are plain text → correctly rejected. Net effect: this
 * only ever OVER-blocks (turns a `\<char>` into whitespace), never under-blocks.
 *
 * The remaining alternatives (unchanged): string forms come before the comment rule
 * so a "#" inside a literal is not read as a comment, and the IRIREF rule (before the
 * comment rule) is why "#" inside `<...cdm#>` is not a comment either. The IRIREF
 * char class approximates the SPARQL grammar's: it forbids whitespace (\s) and
 * `<>"{}|^`\`. Forbidding whitespace is the load-bearing part — the `<` / `<=`
 * comparison operators (always followed by whitespace or an expression) do NOT match
 * as an IRIREF, and an IRIREF match can never span the whitespace separating a
 * keyword like SERVICE, so scrubbing never hides a live keyword. (The grammar also
 * excludes sub-space control chars, which never occur in a real query; \s omits them,
 * which also satisfies the no-control-regex lint.)
 */
const SCRUB_TOKEN_RE =
  /\\[\s\S]|'''(?:\\.|[^\\])*?'''|"""(?:\\.|[^\\])*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|<[^<>"{}|^`\\\s]*>|#[^\n]*/g;

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
 * named `service:`, a variable named `?add`, or a prefixed local name using a
 * PN_LOCAL_ESC escape (`ex:a\#b` → the `\#` becomes a space, splitting the name in
 * this DETECTION copy only) — which the brief deems acceptable. The over-block never
 * reaches the endpoint: only this scrubbed copy is inspected; the ORIGINAL query is
 * what executes.
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
 * Drops whole binding rows from the end until the serialized array fits `budget`
 * characters. Whole-row (never mid-row) truncation keeps every returned row a valid,
 * complete SPARQL binding. `truncated` reports whether any rows were dropped.
 *
 * `budget` is the space available for the bindings array specifically — the caller
 * passes SPARQL_RESPONSE_CHAR_BUDGET minus the surrounding response envelope so the
 * documented cap holds for the FULL serialized payload, not just this array.
 */
function truncateBindings(
  bindings: unknown[],
  budget: number,
): { included: unknown[]; truncated: boolean } {
  if (JSON.stringify(bindings).length <= budget) {
    return { included: bindings, truncated: false };
  }
  const included: unknown[] = [];
  let size = 2; // the enclosing "[]"
  for (const row of bindings) {
    const rowSize = JSON.stringify(row).length + 1; // +1 for the "," separator
    if (size + rowSize > budget) break;
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

  // Reserve space for the response envelope (every key EXCEPT the binding rows) so
  // the char budget covers the FULL serialized payload — measuring bindings alone
  // let the envelope keys push the response slightly over the documented cap. The
  // reservation is deliberately conservative (can only over-reserve, never under):
  //   - returned_rows uses row_count's digit width (returned_rows <= row_count);
  //   - truncated is serialized as `false` (5 chars >= `true`'s 4).
  // We subtract 2 for the "[]" the empty-bindings shell contributes, since
  // truncateBindings counts those brackets itself.
  const envelopeShell: SparqlRawResult = {
    row_count: bindings.length,
    returned_rows: bindings.length,
    truncated: false,
    bindings: [],
  };
  if (json.head?.vars) envelopeShell.vars = json.head.vars;
  if (limitAdded) envelopeShell.limit_added = true;
  const bindingsBudget = Math.max(
    0,
    SPARQL_RESPONSE_CHAR_BUDGET - (JSON.stringify(envelopeShell).length - 2),
  );

  const { included, truncated } = truncateBindings(bindings, bindingsBudget);

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
}): Promise<ToolResult<SparqlRawResult>> {
  try {
    const { query, limitAdded } = validateAndPrepareSparql(input.query);
    const raw = await sharedCellarClient.executeRawSparql(query);
    const result = shapeSparqlResult(raw, limitAdded);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerSparqlTool(server: McpServer): void {
  server.registerTool(
    'eurlex_sparql',
    {
      description:
        'Expert escape hatch: run a raw, read-only SPARQL 1.1 query directly against the EU Publications Office (Cellar) endpoint when the higher-level tools (eurlex_search, eurlex_metadata, eurlex_citations, eurlex_case_law, eurlex_transposition, eurlex_summary, …) cannot express what you need. Requires knowledge of the CDM ontology — READ THE eurlex_guide PROMPT FIRST for the property cheat sheet (celex, title, language, dates, citations, case law, transposition, summaries). Only SELECT and ASK are allowed; SPARQL Update (INSERT/DELETE/…) and federated SERVICE clauses are rejected before the query is sent. A SELECT with no top-level LIMIT gets LIMIT 50 appended (set limit_added); a top-level LIMIT above 100 is rejected. The response mirrors SPARQL JSON — vars + bindings for SELECT, boolean for ASK — plus row_count and a truncated flag (whole rows are dropped past ~40k characters). CELEX/ELI literals are typed xsd:string, so match them with FILTER(STR(?x) = "..."). Example: PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT ?celex WHERE { ?w cdm:resource_legal_id_celex ?celex . FILTER(STR(?celex) = "32016R0679") } LIMIT 1',
      inputSchema: sparqlSchema.shape,
      outputSchema: sparqlOutputSchema.shape,
      annotations: {
        title: 'Run a raw read-only SPARQL query',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexSparql(params)),
  );
}
