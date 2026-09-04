import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  metadataSchema,
  metadataInputSchema,
  metadataOutputSchema,
} from '../schemas/metadataSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import { mergeEffectDates } from '../services/effectDates.js';
import type { MetadataResult, ToolResult } from '../types.js';
import { toCallToolResult, toolError } from '../utils.js';

export async function handleEurlexMetadata(input: {
  celex_id?: string;
  eli?: string;
  oj_ref?: string;
  language: string;
}): Promise<ToolResult<MetadataResult>> {
  try {
    // `server.tool(metadataSchema.shape)` registers only the per-field shape; the
    // "exactly one of celex_id/eli/oj_ref" XOR is an object-level refinement that
    // gets stripped there. Re-parse against the refined schema so it is enforced.
    const parsed = metadataInputSchema.parse(input);

    // Resolve whichever identifier was given to a CELEX ID (celex_id passes
    // through with no network call; eli/oj_ref are looked up via SPARQL).
    const celexId = await sharedCellarClient.resolveCelexId(parsed);

    // SPARQL (2–10 s) and the REST notice (~0.5 s) run in parallel; the notice
    // is optional — on failure the SPARQL result stands (dates typed 'unknown')
    // and one stderr line records why.
    const [base, typedDates] = await Promise.all([
      sharedCellarClient.metadataQuery(celexId, parsed.language),
      sharedCellarClient.effectDatesQuery(celexId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`eurlex_metadata: Cellar notice unavailable for ${celexId} — ${message}`);
        return null;
      }),
    ]);
    const result = mergeEffectDates(base, typedDates);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerMetadataTool(server: McpServer): void {
  server.registerTool(
    'eurlex_metadata',
    {
      description:
        'Fetches metadata for an EU legal act: dates (document, entry into force, application, end of validity, transposition), in-force status, authors, legal basis (CELEX IDs of the acts it is based on), EuroVoc descriptors, and directory codes. date_entry_into_force and date_application are distinct (e.g. the GDPR entered into force on 2016-05-24 but applies from 2018-05-25); dates_effect lists every effect date with its type. Identify the act by celex_id (e.g. "32024R1689"), by eli (e.g. "reg/2016/679" or a full ELI URL), or by oj_ref (post-2023 Official Journal reference, e.g. "OJ:L_202401689") — provide exactly one.',
      inputSchema: metadataSchema.shape,
      outputSchema: metadataOutputSchema.shape,
      annotations: {
        title: 'Get EU legal act metadata',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexMetadata(params)),
  );
}
