import { z } from 'zod';

import { RESOURCE_TYPES } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

import { searchResultSchema } from './searchSchema.js';

export const eurovocSchema = z
  .object({
    concept: z
      .string()
      .min(2)
      .max(500)
      .describe(
        "EuroVoc concept: a label (e.g. 'artificial intelligence') or a URI (e.g. 'http://eurovoc.europa.eu/4424')",
      ),
    resource_type: z.enum(RESOURCE_TYPES).default('any').describe('Document type filter'),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the title and EuroVoc labels, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of results'),
  })
  .strict();

export type EurovocInput = z.infer<typeof eurovocSchema>;

/** Output of eurlex_by_eurovoc: the hits (same shape as eurlex_search) plus count. */
export const eurovocOutputSchema = z.object({
  results: z.array(searchResultSchema).describe('Acts tagged with the EuroVoc concept'),
  total: z.number().int().describe('Number of results in `results`'),
});
