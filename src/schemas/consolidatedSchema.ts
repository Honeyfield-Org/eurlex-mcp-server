import { z } from 'zod';

import { CELEX_REGEX, MAX_CHARS_DEFAULT, MAX_CHARS_LIMIT, MAX_CHARS_MIN } from '../constants.js';
import { DEFAULT_LANGUAGE, LANGUAGE_ENUM } from '../languages.js';

export const consolidatedSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .optional()
      .describe(
        'CELEX ID of the original act, e.g. "32016R0679" (GDPR). Alternative to doc_type + year + number — provide exactly one of the two input forms. Must be a sector-3 secondary-law CELEX (pattern 3YYYY[R|L|D]NNNN).',
      ),
    doc_type: z
      .enum(['reg', 'dir', 'dec'])
      .optional()
      .describe(
        'Document type: reg=regulation, dir=directive, dec=decision. Alternative to celex_id — provide together with year and number.',
      ),
    year: z
      .number()
      .int()
      .min(1950)
      .max(2100)
      .optional()
      .describe(
        'Year of the act, e.g. 2024. Required together with doc_type and number when celex_id is not used.',
      ),
    number: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Document number, e.g. 1689. Required together with doc_type and year when celex_id is not used.',
      ),
    language: LANGUAGE_ENUM.default(DEFAULT_LANGUAGE).describe(
      'Language of the returned text, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    format: z
      .enum(['xhtml', 'plain'])
      .default('xhtml')
      .describe('Output format: xhtml=structured XHTML, plain=text with XHTML tags stripped'),
    max_chars: z
      .number()
      .int()
      .min(MAX_CHARS_MIN)
      .max(MAX_CHARS_LIMIT)
      .default(MAX_CHARS_DEFAULT)
      .describe('Maximum number of characters returned'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Character offset for pagination (0-based)'),
  })
  .strict();

export type ConsolidatedInput = z.infer<typeof consolidatedSchema>;

/**
 * Enforces "exactly one of celex_id / (doc_type + year + number)". This is an
 * object-level invariant that `server.tool(consolidatedSchema.shape)` cannot
 * express: the SDK only registers the per-field shape and strips refinements
 * on the object as a whole. The handler (tools/consolidated.ts) re-validates
 * input against this refined schema — via an explicit `.parse()` call it
 * documents the reason for — to actually enforce the invariant.
 */
export const consolidatedInputSchema = consolidatedSchema.superRefine((data, ctx) => {
  const hasCelex = data.celex_id !== undefined;
  const tripleFields = [data.doc_type, data.year, data.number];
  const hasAnyTripleField = tripleFields.some((field) => field !== undefined);
  const hasFullTriple = tripleFields.every((field) => field !== undefined);

  if (hasCelex && hasAnyTripleField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Provide either celex_id or doc_type + year + number, not both. Pick one input form.',
    });
    return;
  }

  if (!hasCelex && !hasAnyTripleField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide either celex_id or doc_type + year + number to identify the act.',
    });
    return;
  }

  // Remaining cases: celex-only (valid) or triple-only, full or partial.
  if (hasAnyTripleField && !hasFullTriple) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'doc_type, year, and number must all be provided together.',
    });
  }
});

/** Output of eurlex_consolidated: the merged in-force text plus pagination/ELI info. */
export const consolidatedOutputSchema = z.object({
  doc_type: z.string(),
  year: z.number().int(),
  number: z.number().int(),
  language: z.string(),
  content: z.string().describe('The consolidated text in the requested window/format'),
  truncated: z.boolean().describe('True when more text remains beyond this window'),
  returned_chars: z.number().int().describe('Length of `content`'),
  total_chars: z.number().int().describe('Length of the full processed document'),
  offset: z.number().int().describe('The offset this window was sliced from'),
  next_offset: z
    .number()
    .int()
    .nullable()
    .describe('Offset to request next, or null when there is no more content'),
  eli_url: z.string().describe('ELI URL of the consolidated act'),
  consolidated_celex: z
    .string()
    .describe('Resolved consolidated CELEX, e.g. "02016R0679-20160504"'),
  consolidation_date: z
    .string()
    .nullable()
    .describe('ISO date from the CELEX "-YYYYMMDD" suffix, or null when absent'),
});
