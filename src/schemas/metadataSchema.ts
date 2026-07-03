import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';

export const metadataSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe("CELEX identifier, e.g. '32024R1689' for the AI Act"),
    language: z
      .enum(['DEU', 'ENG', 'FRA'])
      .default('DEU')
      .describe('Language of the title and EuroVoc labels'),
  })
  .strict();

export type MetadataInput = z.infer<typeof metadataSchema>;
