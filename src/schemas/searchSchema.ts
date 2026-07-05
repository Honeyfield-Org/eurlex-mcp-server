import { z } from 'zod';

import { RESOURCE_TYPES } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const searchSchema = z
  .object({
    query: z
      .string()
      .min(3)
      .max(500)
      .describe(
        'Title substring to search for, e.g. "artificial intelligence high risk". Matched as a contiguous phrase, case-insensitive.',
      ),
    resource_type: z
      .enum(RESOURCE_TYPES)
      .default('any')
      .describe(
        'Document type filter: REG=regulation, DIR=directive, DEC=decision, JUDG=judgment, REG_IMPL=implementing regulation, REG_DEL=delegated regulation, RECO=recommendation, ORDER=court order, OPIN_AG=Advocate General opinion',
      ),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the title and full text, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of results'),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Filter from this date onward, format YYYY-MM-DD'),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Filter up to this date, format YYYY-MM-DD'),
  })
  .strict();

export type SearchInput = z.infer<typeof searchSchema>;

/**
 * One search hit. Shared by eurlex_search and eurlex_by_eurovoc (both return the
 * same result shape), so it lives here and is imported by eurovocSchema.
 */
export const searchResultSchema = z.object({
  celex: z.string().describe('CELEX identifier of the act, e.g. "32024R1689"'),
  title: z.string().describe('Act title in the requested language'),
  date: z.string().describe('Document date (ISO YYYY-MM-DD), or "" when absent'),
  type: z.string().describe('Resource type, e.g. "REG", "DIR", "DEC"'),
  eurlex_url: z.string().describe('EUR-Lex page for the act'),
});

/** Output of eurlex_search: the hits plus their count. */
export const searchOutputSchema = z.object({
  results: z.array(searchResultSchema).describe('Matching acts, newest-first within the sample'),
  total: z.number().int().describe('Number of results in `results`'),
});
