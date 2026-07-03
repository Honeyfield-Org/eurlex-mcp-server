import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { eurovocSchema } from '../schemas/eurovocSchema.js';
import { CellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexByEurovoc(input: {
  concept: string;
  resource_type: string;
  language: string;
  limit: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const client = new CellarClient();
    const results = await client.eurovocQuery(
      input.concept,
      input.resource_type,
      input.language,
      input.limit,
    );

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No results for EuroVoc concept "${input.concept}"`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ results, total: results.length }),
        },
      ],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerEurovocTool(server: McpServer): void {
  server.tool(
    'eurlex_by_eurovoc',
    'Searches EU legal acts by EuroVoc thematic concept — the right tool for "documents about X" when the term may not appear in the title. Accepts a concept label (e.g. "artificial intelligence") or a EuroVoc URI.',
    eurovocSchema.shape,
    {
      title: 'Search EU law by topic',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexByEurovoc(params),
  );
}
