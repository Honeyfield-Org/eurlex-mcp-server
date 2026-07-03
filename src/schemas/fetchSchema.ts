import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';

export const fetchSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .describe("CELEX-Identifier, z.B. '32024R1689' für den AI Act"),
    language: z.enum(['DEU', 'ENG', 'FRA']).default('DEU').describe('Sprache des Volltexts'),
    format: z
      .enum(['xhtml', 'plain'])
      .default('xhtml')
      .describe('Ausgabeformat: xhtml=strukturiertes XHTML, plain=Text (XHTML-Tags entfernt)'),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(50000)
      .default(20000)
      .describe('Maximale Zeichenanzahl des zurückgegebenen Texts'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Character offset for pagination (0-based)'),
  })
  .strict();

export type FetchInput = z.infer<typeof fetchSchema>;
