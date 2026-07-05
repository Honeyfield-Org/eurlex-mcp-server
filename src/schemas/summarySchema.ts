import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
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

export type SummaryInput = z.infer<typeof summarySchema>;
