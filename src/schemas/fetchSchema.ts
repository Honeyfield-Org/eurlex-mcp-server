import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const fetchSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe("CELEX identifier, e.g. '32024R1689' for the AI Act"),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the full text, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
    format: z
      .enum(['xhtml', 'plain'])
      .default('xhtml')
      .describe('Output format: xhtml=structured XHTML, plain=text with XHTML tags stripped'),
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

export type FetchInput = z.infer<typeof fetchSchema>;
