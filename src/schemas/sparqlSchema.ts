import { z } from 'zod';

import { SPARQL_QUERY_MIN_LENGTH, SPARQL_QUERY_MAX_LENGTH } from '../constants.js';

/**
 * Input schema for `eurlex_sparql`. A single required `query` string, length-bounded
 * so empty/abusive payloads are rejected before any parsing. The read-only guard
 * (SELECT/ASK only, no SPARQL Update / SERVICE) and the LIMIT policy are NOT
 * expressed here — they need to strip strings/comments and emit clear, specific
 * rejection messages, so they live in validateAndPrepareSparql() in the handler.
 */
export const sparqlSchema = z
  .object({
    query: z
      .string()
      .min(SPARQL_QUERY_MIN_LENGTH)
      .max(SPARQL_QUERY_MAX_LENGTH)
      .describe(
        'A raw SPARQL 1.1 query against the EU Publications Office (Cellar) endpoint. ' +
          'Read-only: only SELECT and ASK are accepted (SPARQL Update and federated SERVICE ' +
          'clauses are rejected). If a SELECT has no top-level LIMIT one is appended automatically; ' +
          'a top-level LIMIT above 100 is rejected. Uses the CDM ontology — see the eurlex_guide ' +
          'prompt for the property cheat sheet. Example: ' +
          'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> ' +
          'SELECT ?celex WHERE { ?w cdm:resource_legal_id_celex ?celex . ' +
          'FILTER(STR(?celex) = "32016R0679") } LIMIT 1',
      ),
  })
  .strict();

export type SparqlInput = z.infer<typeof sparqlSchema>;

/**
 * Output of eurlex_sparql. Mirrors a SPARQL 1.1 JSON result and layers on the
 * tool's row accounting. SELECT populates vars/bindings and numeric row_count/
 * returned_rows; ASK populates boolean and leaves those null. `truncated` is
 * always present; `limit_added` appears only when the tool auto-appended LIMIT.
 * `bindings` holds raw SPARQL binding objects unchanged (no per-cell reshaping),
 * so each row is an open object of arbitrary keys.
 */
export const sparqlOutputSchema = z.object({
  vars: z.array(z.string()).optional().describe('Projected variable names (SELECT only)'),
  row_count: z.number().int().nullable().describe('Total rows the query returned; null for ASK'),
  returned_rows: z
    .number()
    .int()
    .nullable()
    .describe('Rows included after char-budget truncation; null for ASK'),
  truncated: z.boolean().describe('True when whole rows were dropped to fit the char budget'),
  bindings: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Raw SPARQL binding rows, possibly truncated (SELECT only)'),
  boolean: z.boolean().optional().describe('ASK result (present only for ASK queries)'),
  limit_added: z
    .literal(true)
    .optional()
    .describe('Present (true) only when the tool auto-appended the default LIMIT'),
});
