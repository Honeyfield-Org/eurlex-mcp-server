import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { searchSchema } from '../schemas/searchSchema.js';
import { CellarClient } from '../services/cellarClient.js';
import type { SearchToolOutput } from '../types.js';
import { toolError } from '../utils.js';

export async function handleEurlexSearch(input: {
  query: string;
  resource_type: string;
  language: string;
  limit: number;
  date_from?: string;
  date_to?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const client = new CellarClient();
    const { results } = await client.sparqlQuery(input.query, {
      resource_type: input.resource_type,
      language: input.language,
      limit: input.limit,
      date_from: input.date_from,
      date_to: input.date_to,
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `Keine Ergebnisse für "${input.query}"` }],
      };
    }

    const output: SearchToolOutput = { results, total: results.length };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(output),
        },
      ],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerSearchTool(server: McpServer): void {
  server.tool(
    'eurlex_search',
    'Sucht EU-Rechtsakte nach Titel via EUR-Lex SPARQL',
    searchSchema.shape,
    { readOnlyHint: true, destructiveHint: false },
    async (params) => handleEurlexSearch(params),
  );
}
