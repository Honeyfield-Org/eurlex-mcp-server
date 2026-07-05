import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { COUNTRY_ENUM } from '../countries.js';
import { LANGUAGE_ENUM } from '../languages.js';

/**
 * Input schema for `eurlex_transposition`. Unlike caseLaw/consolidated, there
 * is no object-level invariant here — `celex_id` is a single required field —
 * so no superRefine/refined-schema is needed; `server.tool(schema.shape)`
 * enforces every rule the handler relies on.
 */
export const transpositionSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe(
        'Sector-3 CELEX of the EU directive whose national transposition measures you want, e.g. "32022L2555" (NIS2) or "31995L0046" (Data Protection Directive). Member states transpose directives (CELEX type letter L); regulations and decisions generally have no national implementing measures.',
      ),
    country: COUNTRY_ENUM.optional().describe(
      'Optional filter: EU 2-letter member-state code (ISO 3166-1 alpha-2, except Greece which is "EL" in EU usage), e.g. "DE", "AT", "FR". Omit to return measures from all member states.',
    ),
    language: LANGUAGE_ENUM.default('DEU').describe(
      "Sets the locale of each result's eurlex_url (as a Cellar 3-letter code, any of the 24 official EU languages). NOTE: a national implementing measure's title is stored only in the member state's own official language and is returned as-is — this field does NOT translate titles.",
    ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe(
        'Maximum number of measures to return (1–100). The response also reports total_found (the full count).',
      ),
  })
  .strict();

export type TranspositionInput = z.infer<typeof transpositionSchema>;

const transpositionEntrySchema = z.object({
  country: z
    .string()
    .describe('Member state: 2-letter code when known, else the raw alpha-3 authority code'),
  title: z.string().describe("National measure title in the member state's own language, or ''"),
  date: z.string().describe("ISO date of the national measure, or '' when absent"),
  celex: z.string().describe('Sector-7 NIM CELEX, e.g. "72022L2555DEU_202500123"'),
  eurlex_url: z.string(),
});

/** Output of eurlex_transposition: the national measures plus count accounting. */
export const transpositionOutputSchema = z.object({
  celex_id: z.string().describe('The directive CELEX that was queried'),
  results: z.array(transpositionEntrySchema),
  returned: z.number().int().describe('Number of measures in `results` (<= limit)'),
  total_found: z
    .number()
    .int()
    .describe('Full number of matching measures; when > returned, `results` was truncated'),
});
