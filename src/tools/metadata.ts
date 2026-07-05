import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { metadataSchema, metadataInputSchema } from '../schemas/metadataSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexMetadata(input: {
  celex_id?: string;
  eli?: string;
  oj_ref?: string;
  language: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    // `server.tool(metadataSchema.shape)` registers only the per-field shape; the
    // "exactly one of celex_id/eli/oj_ref" XOR is an object-level refinement that
    // gets stripped there. Re-parse against the refined schema so it is enforced.
    const parsed = metadataInputSchema.parse(input);

    // Resolve whichever identifier was given to a CELEX ID (celex_id passes
    // through with no network call; eli/oj_ref are looked up via SPARQL).
    const celexId = await sharedCellarClient.resolveCelexId(parsed);

    const result = await sharedCellarClient.metadataQuery(celexId, parsed.language);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerMetadataTool(server: McpServer): void {
  server.tool(
    'eurlex_metadata',
    'Fetches metadata for an EU legal act: document/entry-into-force/end-of-validity dates, in-force status, authors, legal basis (CELEX IDs of the acts it is based on), EuroVoc descriptors, and directory codes. Identify the act by celex_id (e.g. "32024R1689"), by eli (e.g. "reg/2016/679" or a full ELI URL), or by oj_ref (post-2023 Official Journal reference, e.g. "OJ:L_202401689") — provide exactly one.',
    metadataSchema.shape,
    {
      title: 'Get EU legal act metadata',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexMetadata(params),
  );
}
