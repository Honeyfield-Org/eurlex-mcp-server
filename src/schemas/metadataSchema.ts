import { z } from 'zod';

import { CELEX_REGEX } from '../constants.js';
import { LANGUAGE_ENUM } from '../languages.js';

export const metadataSchema = z
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
      'Language of the title and EuroVoc labels, as a Cellar 3-letter code (any of the 24 official EU languages, e.g. DEU, ENG, FRA, POL, SPA)',
    ),
  })
  .strict();

export type MetadataInput = z.infer<typeof metadataSchema>;

/**
 * Enforces "exactly one of celex_id / eli / oj_ref". Like consolidatedInputSchema,
 * this is an object-level invariant that `server.tool(metadataSchema.shape)` cannot
 * express — the SDK registers only the per-field shape and strips whole-object
 * refinements. The handler (tools/metadata.ts) re-validates input against this
 * refined schema via an explicit `.parse()` call to actually enforce the XOR.
 */
export const metadataInputSchema = metadataSchema.superRefine((data, ctx) => {
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

/**
 * Output of eurlex_metadata. Dates and in_force are nullable: Cellar frequently
 * omits them, and date_end_of_validity is also nulled when it is the "9999-12-31"
 * open-ended sentinel. The array fields are always present (empty when none).
 */
export const metadataOutputSchema = z.object({
  celex_id: z.string(),
  title: z.string(),
  date_document: z.string().nullable().describe('ISO date, or null when absent'),
  date_entry_into_force: z.string().nullable().describe('ISO date, or null when absent'),
  date_end_of_validity: z
    .string()
    .nullable()
    .describe('ISO date, or null when absent or the open-ended 9999-12-31 sentinel'),
  in_force: z.boolean().nullable().describe('In-force status, or null when unknown'),
  date_transposition: z.string().nullable().describe('ISO date, or null when absent'),
  resource_type: z.string(),
  authors: z.array(z.string()),
  eurovoc_concepts: z.array(z.string()),
  directory_codes: z
    .array(z.string())
    .describe('Directory-code entries as "{code}: {label}", or the bare code when unlabelled'),
  legal_basis: z.array(z.string()).describe('CELEX IDs of the acts this act is based on'),
  eurlex_url: z.string(),
});
