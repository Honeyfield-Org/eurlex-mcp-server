import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { DEFAULT_LANGUAGE, LANGUAGE_ENUM } from '../languages.js';

/**
 * European Case Law Identifier, e.g. "ECLI:EU:C:2014:317" (Google Spain) or
 * "ECLI:EU:T:2007:289" (a General Court judgment). Structure:
 * ECLI:{country}:{court}:{year}:{ordinal}. Kept deliberately permissive
 * (any 2-letter country, 1–7 char court code) so valid national ECLIs are not
 * rejected — the value is still matched exactly against the stored
 * `cdm:case-law_ecli` literal and escaped as defense-in-depth.
 *
 * Case-insensitive (`/i`) so lowercase/mixed-case user input validates —
 * Cellar's canonical ECLI literals are always uppercase, so
 * `CellarClient.buildCaseLawQuery` uppercases the value before it enters the
 * SPARQL FILTER; without that normalization a lowercase input would pass
 * validation here but silently match zero rows.
 */
export const ECLI_REGEX = /^ECLI:[A-Z]{2}:[A-Z0-9]{1,7}:\d{4}:[A-Z0-9.]{1,25}$/i;

/** Case-law procedure types (CDM resource-types), plus "any". */
export const CASE_LAW_TYPES = ['JUDG', 'ORDER', 'OPIN_AG', 'any'] as const;

/** Court dimension, mapped to the CDM authoring corporate body in the client. */
export const COURTS = ['COURT_JUSTICE', 'GENERAL_COURT', 'any'] as const;

export const caseLawSchema = z
  .object({
    query: z
      .string()
      .min(3)
      .max(500)
      .optional()
      .describe(
        'Title substring to search for among case law, e.g. "Schrems" or a party name. Matched as a contiguous phrase, case-insensitive. Note: CJEU titles begin with a boilerplate prefix ("Judgment of the Court …"); party names appear after it.',
      ),
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .optional()
      .describe(
        'Sector-6 CELEX identifier of a specific ruling, e.g. "62012CJ0131" (Google Spain).',
      ),
    ecli: z
      .string()
      .regex(ECLI_REGEX)
      .optional()
      .describe('European Case Law Identifier, e.g. "ECLI:EU:C:2014:317" (Google Spain).'),
    related_celex: z
      .string()
      .regex(CELEX_REGEX)
      .optional()
      .describe(
        'CELEX of a legal act (e.g. "32016R0679" for the GDPR); returns the case law that interprets that act.',
      ),
    court: z
      .enum(COURTS)
      .default('any')
      .describe(
        'Court filter: COURT_JUSTICE=Court of Justice, GENERAL_COURT=General Court, any=both.',
      ),
    type: z
      .enum(CASE_LAW_TYPES)
      .default('any')
      .describe(
        'Procedure type filter: JUDG=judgment, ORDER=court order, OPIN_AG=Advocate General opinion, any=all case-law document types (incl. procedural notices).',
      ),
    language: LANGUAGE_ENUM.default(DEFAULT_LANGUAGE).describe(
      'Language of the title, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA). A ruling with no title in this language yields no result.',
    ),
    limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of results'),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Filter from this judgment date onward, format YYYY-MM-DD'),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Filter up to this judgment date, format YYYY-MM-DD'),
  })
  .strict();

export type CaseLawInput = z.infer<typeof caseLawSchema>;

/**
 * Enforces "at least one of query / celex_id / ecli / related_celex". Like
 * metadataInputSchema, this is an object-level invariant that
 * `server.tool(caseLawSchema.shape)` cannot express — the SDK registers only the
 * per-field shape and strips whole-object refinements. The handler
 * (tools/caseLaw.ts) re-validates input against this refined schema via an
 * explicit `.parse()` call to actually enforce the rule. Unlike the fetch/metadata
 * XOR, the four primary inputs here MAY be combined (e.g. query + related_celex),
 * so only the "at least one" lower bound is enforced.
 */
export const caseLawInputSchema = caseLawSchema.superRefine((data, ctx) => {
  const provided = [data.query, data.celex_id, data.ecli, data.related_celex].filter(
    (v) => v !== undefined,
  );
  if (provided.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one search input: query, celex_id, ecli, or related_celex.',
    });
  }
});

const caseLawEntrySchema = z.object({
  celex: z.string().describe('Sector-6 CELEX of the ruling'),
  ecli: z.string().describe('ECLI of the ruling, or "" when the work carries none'),
  title: z.string(),
  date: z.string().describe('Judgment date (ISO), or "" when absent'),
  type: z.string().describe('Procedure type, e.g. "JUDG", "ORDER", "OPIN_AG"'),
  eurlex_url: z.string(),
});

/** Output of eurlex_case_law: the matching rulings plus their count. */
export const caseLawOutputSchema = z.object({
  results: z.array(caseLawEntrySchema),
  total: z.number().int().describe('Number of entries in `results`'),
});
