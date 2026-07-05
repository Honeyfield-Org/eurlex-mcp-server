import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const metadataSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe("CELEX identifier, e.g. '32024R1689' for the AI Act"),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the title and EuroVoc labels, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
  })
  .strict();

export type MetadataInput = z.infer<typeof metadataSchema>;
