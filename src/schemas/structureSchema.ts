import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const structureSchema = z
  .object({
    celex_id: z
      .string()
      .regex(CELEX_REGEX)
      .optional()
      .describe(
        'CELEX identifier, e.g. "32024R1689" (AI Act). Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    eli: z
      .string()
      .min(1)
      .optional()
      .describe(
        'European Legislation Identifier (ELI), short or full form, e.g. "reg/2016/679" or "http://data.europa.eu/eli/reg/2016/679/oj" (GDPR). Resolved to a CELEX ID via Cellar. Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    oj_ref: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Official Journal reference in the post-2023 scheme, e.g. "OJ:L_202401689" (AI Act). Resolved to a CELEX ID via Cellar. Provide exactly one of celex_id, eli, or oj_ref.',
      ),
    language: LANGUAGE_ENUM.default('DEU').describe(
      'Language of the document to outline, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA). Heading labels are language-specific; the returned offsets index the plain text of THIS language, so pass the same language to the follow-up eurlex_fetch call.',
    ),
  })
  .strict();

export type StructureInput = z.infer<typeof structureSchema>;

/**
 * Enforces "exactly one of celex_id / eli / oj_ref" — identical in spirit to
 * fetchInputSchema. `server.tool(structureSchema.shape)` registers only the
 * per-field shape and strips whole-object refinements, so the handler
 * (tools/structure.ts) re-validates input against this refined schema via an
 * explicit `.parse()` to actually enforce the XOR.
 */
export const structureInputSchema = structureSchema.superRefine((data, ctx) => {
  const provided = [data.celex_id, data.eli, data.oj_ref].filter((v) => v !== undefined);
  if (provided.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one identifier: celex_id, eli, or oj_ref.',
    });
  } else if (provided.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide only one identifier (celex_id, eli, or oj_ref), not several.',
    });
  }
});

const outlineEntrySchema = z.object({
  level: z
    .number()
    .int()
    .describe('Nesting-depth hint: 1=part/title/annex, 2=chapter, 3=section, 4=article/paragraph'),
  label: z.string().describe('Normalized heading label, e.g. "Article 5", "CHAPTER I"'),
  title: z.string().describe("The heading's subtitle, or '' when there is none"),
  offset: z.number().int().describe('0-based char offset of the label in the plain text'),
});

/** Output of eurlex_structure: the document outline with plain-text offsets. */
export const structureOutputSchema = z.object({
  celex_id: z.string().describe('The resolved CELEX ID (echoed for the follow-up eurlex_fetch)'),
  language: z.string(),
  total_headings: z.number().int().describe('Total headings detected before the returned-list cap'),
  returned: z.number().int().describe('Number of headings in `outline` (<= total_headings)'),
  truncated: z.boolean().describe('True when `outline` was capped below total_headings'),
  total_chars: z
    .number()
    .int()
    .describe('Length of the plain text the offsets index into (matches eurlex_fetch total_chars)'),
  outline: z.array(outlineEntrySchema).describe('Headings in document order'),
  source_url: z.string(),
  note: z
    .string()
    .optional()
    .describe('Present only when no headings were found or the outline was truncated'),
});
