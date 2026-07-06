import { z } from 'zod';

import { CELEX_REGEX, MAX_CHARS_DEFAULT, MAX_CHARS_LIMIT, MAX_CHARS_MIN } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

/**
 * Input schema for `eurlex_summary`. Like transpositionSchema, `celex_id` is a
 * single required field with no object-level invariant, so `server.tool(schema.shape)`
 * enforces every rule the handler relies on — no superRefine/refined schema needed.
 * max_chars/offset mirror fetchSchema so summaries paginate the same way full texts do.
 */
export const summarySchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe(
        'CELEX identifier of the EU act to summarize, e.g. "32016R0679" (GDPR) or "32022R2065" (Digital Services Act). LEGISSUM summaries exist for several thousand major acts; many acts have none.',
      ),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the summary text, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA). Summaries are typically available in all 24 languages.',
    ),
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

export type SummaryInput = z.infer<typeof summarySchema>;

const summaryReferenceSchema = z.object({
  legissum_id: z.string(),
  title: z.string(),
  date: z.string(),
  obsolete: z.boolean(),
});

/**
 * Output of eurlex_summary. `celex_id`, `language` and `total_summaries` are
 * always present; `total_summaries === 0` is the not-found case, where all the
 * summary-content fields below are absent. When a summary IS found
 * (total_summaries >= 1) those fields are populated. Modelling it as one object
 * with the content fields optional lets the SDK's single outputSchema (which must
 * be an object) cover both outcomes without treating "no summary" as an error.
 */
export const summaryOutputSchema = z.object({
  celex_id: z.string().describe('The act CELEX that was queried'),
  language: z.string(),
  total_summaries: z
    .number()
    .int()
    .describe('Total LEGISSUM summaries linked to this act; 0 means none was found'),
  legissum_id: z.string().optional().describe('LEGISSUM id of the returned (primary) summary'),
  title: z.string().optional(),
  date: z.string().optional().describe("ISO date of the returned summary, or ''"),
  obsolete: z.boolean().optional().describe('True when the returned summary is flagged obsolete'),
  content: z.string().optional().describe('Summary text (plain, HTML stripped), sliced to window'),
  truncated: z.boolean().optional().describe('True when more content remains beyond this window'),
  returned_chars: z.number().int().optional().describe('Length of `content`'),
  total_chars: z.number().int().optional().describe('Length of the full processed summary'),
  offset: z.number().int().optional().describe('The offset this window was sliced from'),
  next_offset: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Offset to request next, or null when there is no more content'),
  other_summaries: z
    .array(summaryReferenceSchema)
    .optional()
    .describe('Other summaries for the same act (present only when total_summaries > 1)'),
  source_url: z.string().optional().describe('EUR-Lex legislative-summary (LSU) page for the act'),
});
