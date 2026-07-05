import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const fetchSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .optional()
      .describe(
        'CELEX identifier, e.g. "32024R1689" (AI Act). Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    eli: z
      .string()
      .min(1)
      .optional()
      .describe(
        'European Legislation Identifier (ELI), short or full form, e.g. "reg/2016/679" or "http://data.europa.eu/eli/reg/2016/679/oj" (GDPR). Resolved to a CELEX ID via Cellar. Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    oj_ref: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Official Journal reference in the post-2023 scheme, e.g. "OJ:L_202401689" (AI Act). Resolved to a CELEX ID via Cellar. Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the full text, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    format: z
      .enum(['xhtml', 'plain'])
      .default('xhtml')
      .describe('Output format: xhtml=structured XHTML, plain=text with XHTML tags stripped'),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(50000)
      .default(20000)
      .describe('Maximum number of characters returned'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Character offset for pagination (0-based)'),
  })
  .strict();

export type FetchInput = z.infer<typeof fetchSchema>;

/**
 * Enforces "exactly one of celex_id / eli / oj_ref". Like consolidatedInputSchema,
 * this is an object-level invariant that `server.tool(fetchSchema.shape)` cannot
 * express — the SDK registers only the per-field shape and strips whole-object
 * refinements. The handler (tools/fetch.ts) re-validates input against this refined
 * schema via an explicit `.parse()` call to actually enforce the XOR.
 */
export const fetchInputSchema = fetchSchema.superRefine((data, ctx) => {
  const provided = [data.celex_id, data.eli, data.oj_ref].filter((v) => v !== undefined);
  if (provided.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one identifier: celex_id, eli, or oj_ref.',
    });
  } else if (provided.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide only one identifier (celex_id, eli, or oj_ref), not several.',
    });
  }
});

/** Output of eurlex_fetch: the sliced document text plus pagination accounting. */
export const fetchOutputSchema = z.object({
  celex_id: z.string().describe('The resolved CELEX ID the text was fetched for'),
  language: z.string().describe('Cellar 3-letter language code of the text'),
  content: z.string().describe('The document text in the requested window/format'),
  truncated: z.boolean().describe('True when more text remains beyond this window'),
  returned_chars: z.number().int().describe('Length of `content`'),
  total_chars: z.number().int().describe('Length of the full processed document'),
  offset: z.number().int().describe('The offset this window was sliced from'),
  next_offset: z
    .number()
    .int()
    .nullable()
    .describe('Offset to request next, or null when there is no more content'),
  source_url: z.string().describe('Cellar REST URL of the fetched resource'),
});
