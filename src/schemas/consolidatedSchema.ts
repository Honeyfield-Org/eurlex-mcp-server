import { z } from 'zod';

export const consolidatedSchema = z
  .object({
    doc_type: z
      .enum(['reg', 'dir', 'dec'])
      .describe('Dokumenttyp: reg=Verordnung, dir=Richtlinie, dec=Entscheidung'),
    year: z.number().int().min(1950).max(2100).describe('Jahr des Rechtsakts, z.B. 2024'),
    number: z.number().int().min(1).describe('Dokumentnummer, z.B. 1689'),
    language: z.enum(['DEU', 'ENG', 'FRA']).default('DEU').describe('Sprache'),
    format: z.enum(['xhtml', 'plain']).default('xhtml').describe('Ausgabeformat'),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(50000)
      .default(20000)
      .describe('Maximale Zeichenanzahl'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Character offset for pagination (0-based)'),
  })
  .strict();

export type ConsolidatedInput = z.infer<typeof consolidatedSchema>;
