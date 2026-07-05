import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const citationsSchema = z
  .object({
    celex_id: z.string().regex(CELEX_REGEX).describe("CELEX identifier, e.g. '32024R1689'"),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the title, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    direction: z
      .enum(['cites', 'cited_by', 'both'])
      .default('both')
      .describe(
        'Direction: cites=acts referenced by this document, cited_by=acts referencing this document, both=a balanced split of both directions',
      ),
    limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of results'),
  })
  .strict();

export type CitationsInput = z.infer<typeof citationsSchema>;
