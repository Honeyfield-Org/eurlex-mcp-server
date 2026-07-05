import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { searchSchema } from '../schemas/searchSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
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
    const { results } = await sharedCellarClient.sparqlQuery(input.query, {
      resource_type: input.resource_type,
      language: input.language,
      limit: input.limit,
      date_from: input.date_from,
      date_to: input.date_to,
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No results for "${input.query}"` }],
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
    'Searches EU legal acts by title substring (contiguous phrase, case-insensitive — not tokenized full-text search). For topic-based discovery use eurlex_by_eurovoc instead. Broad single-word terms can be slow; narrow with resource_type or date_from/date_to. Supports all 24 official EU languages (pass the Cellar 3-letter code, e.g. DEU, ENG, FRA, POL, SPA); match the query term to the chosen language. Results are newest-first within the fetched sample, not necessarily the globally newest match for very broad queries.',
    searchSchema.shape,
    {
      title: 'Search EU law by title',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexSearch(params),
  );
}
