import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { citationsSchema } from '../schemas/citationsSchema.js';
import { CellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexCitations(input: {
  celex_id: string;
  language: string;
  direction: 'cites' | 'cited_by' | 'both';
  limit: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const client = new CellarClient();
    const result = await client.citationsQuery(
      input.celex_id,
      input.language,
      input.direction,
      input.limit,
    );

    if (result.citations.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No citations found for CELEX: ${input.celex_id}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerCitationsTool(server: McpServer): void {
  server.tool(
    'eurlex_citations',
    'Finds citation relationships for an EU legal act: cites, cited_by, amends/amended_by, based_on/basis_for, repeals/repealed_by. direction="both" runs a balanced split so recent cited_by entries cannot crowd out cites results; the response\'s counts field reports how many of each side were found.',
    citationsSchema.shape,
    {
      title: 'Find EU legal act citations',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexCitations(params),
  );
}
