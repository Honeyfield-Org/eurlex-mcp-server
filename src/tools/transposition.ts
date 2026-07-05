import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { transpositionSchema, transpositionOutputSchema } from '../schemas/transpositionSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { ToolResult, TranspositionResult } from '../types.js';
import { toCallToolResult, toolError } from '../utils.js';

export async function handleEurlexTransposition(input: {
  celex_id: string;
  country?: string;
  language: string;
  limit: number;
}): Promise<ToolResult<TranspositionResult>> {
  try {
    const result = await sharedCellarClient.transpositionQuery({
      celex_id: input.celex_id,
      country: input.country,
      language: input.language,
      limit: input.limit,
    });

    if (result.results.length === 0) {
      const where = input.country ? ` in ${input.country}` : '';
      // `result` is a well-formed TranspositionResult with an empty list — emit it structured.
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `No national implementing measures found for ${input.celex_id}${where}. ` +
              'NIMs exist once member states notify transposition of a directive; ' +
              'regulations and decisions generally have none, and verify the CELEX is a directive.',
          },
        ],
        structuredContent: result,
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerTranspositionTool(server: McpServer): void {
  server.registerTool(
    'eurlex_transposition',
    {
      description:
        'Lists the national implementing measures (NIMs) EU member states enacted to transpose a given EU directive into national law — the answer to "how did member state X implement directive Y" for transposition and compliance tracking. Input celex_id is the directive\'s sector-3 CELEX (e.g. "32022L2555" for NIS2, "31995L0046" for the Data Protection Directive); optionally filter by country (2-letter member-state code, e.g. "DE"). Each result gives the member state, the national measure\'s title (in that state\'s own official language — not translated), its date, the sector-7 NIM CELEX reference, and a EUR-Lex URL. total_found reports the full count; results is capped at limit. For the directive itself use eurlex_fetch/eurlex_metadata; regulations and decisions have no NIMs.',
      inputSchema: transpositionSchema.shape,
      outputSchema: transpositionOutputSchema.shape,
      annotations: {
        title: 'Find national transposition measures',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexTransposition(params)),
  );
}
