import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { eurovocSchema } from '../schemas/eurovocSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexByEurovoc(input: {
  concept: string;
  resource_type: string;
  language: string;
  limit: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    // A label (as opposed to a URI) is resolved here first, rather than inside
    // eurovocQuery, so a "no concept found at all" result can be told apart
    // from "concept found, but no matching documents" (see the two distinct
    // messages below — the live-smoke finding was that both looked identical).
    const isUri = input.concept.startsWith('http');
    let conceptUri = input.concept;

    if (!isUri) {
      const resolved = await sharedCellarClient.resolveEurovocLabel(input.concept, input.language);
      if (resolved === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `No EuroVoc concept matches "${input.concept}" — labels were tried in the request ` +
                'language and, as a fallback, across all 24 official EU languages, with no match. ' +
                'Try a different or more specific term, or pass a EuroVoc concept URI directly ' +
                '(e.g. "http://eurovoc.europa.eu/4424").',
            },
          ],
        };
      }
      conceptUri = resolved;
    }

    const results = await sharedCellarClient.eurovocQuery(
      conceptUri,
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
    'Searches EU legal acts by EuroVoc thematic concept — the right tool for "documents about X" when the term may not appear in the title. Accepts a concept label in any official EU language (e.g. "artificial intelligence") or a EuroVoc URI; label resolution automatically falls back across all 24 official EU languages if the request language has no match, so the example works regardless of the default `language`.',
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
