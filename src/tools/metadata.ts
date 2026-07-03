import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { metadataSchema } from '../schemas/metadataSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexMetadata(input: {
  celex_id: string;
  language: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const result = await sharedCellarClient.metadataQuery(input.celex_id, input.language);
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
    'Fetches metadata for an EU legal act by CELEX ID: document/entry-into-force/end-of-validity dates, in-force status, authors, legal basis (CELEX IDs of the acts it is based on), EuroVoc descriptors, and directory codes.',
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
