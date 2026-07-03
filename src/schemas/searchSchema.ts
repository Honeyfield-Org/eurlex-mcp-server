import { z } from 'zod';

import { RESOURCE_TYPES } from '../constants.js';

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
    language: z
      .enum(['DEU', 'ENG', 'FRA'])
      .default('DEU')
      .describe('Language of the title and full text'),
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
