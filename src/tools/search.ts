import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { searchSchema, searchOutputSchema } from '../schemas/searchSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { SearchToolOutput, ToolResult } from '../types.js';
import { toCallToolResult, toolError } from '../utils.js';

export async function handleEurlexSearch(input: {
  query: string;
  resource_type: string;
  language: string;
  limit: number;
  date_from?: string;
  date_to?: string;
}): Promise<ToolResult<SearchToolOutput>> {
  try {
    const { results } = await sharedCellarClient.sparqlQuery(input.query, {
      resource_type: input.resource_type,
      language: input.language,
      limit: input.limit,
      date_from: input.date_from,
      date_to: input.date_to,
    });

    if (results.length === 0) {
      // Still a valid (empty) result, so it carries structuredContent the
      // outputSchema accepts; the text stays a friendly message rather than "{}".
      return {
        content: [{ type: 'text' as const, text: `No results for "${input.query}"` }],
        structuredContent: { results: [], total: 0 },
      };
    }

    const output: SearchToolOutput = { results, total: results.length };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    'eurlex_search',
    {
      description:
        'Searches EU legal acts by title substring (contiguous phrase, case-insensitive — not tokenized full-text search). For topic-based discovery use eurlex_by_eurovoc instead. Broad single-word terms can be slow; narrow with resource_type or date_from/date_to. Supports all 24 official EU languages (pass the Cellar 3-letter code, e.g. DEU, ENG, FRA, POL, SPA); match the query term to the chosen language. Results are newest-first within the fetched sample, not necessarily the globally newest match for very broad queries.',
      inputSchema: searchSchema.shape,
      outputSchema: searchOutputSchema.shape,
      annotations: {
        title: 'Search EU law by title',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexSearch(params)),
  );
}
