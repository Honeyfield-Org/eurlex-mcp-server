import { z } from 'zod';

import { RESOURCE_TYPES } from '../constants.js';

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
    language: z
      .enum(['DEU', 'ENG', 'FRA'])
      .default('DEU')
      .describe('Language of the title and EuroVoc labels'),
    limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of results'),
  })
  .strict();

export type EurovocInput = z.infer<typeof eurovocSchema>;
