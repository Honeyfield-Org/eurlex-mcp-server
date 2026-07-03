import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CELLAR_REST_BASE } from '../constants.js';
import { fetchSchema } from '../schemas/fetchSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { FetchResult } from '../types.js';
import { processContent, toolError } from '../utils.js';

export async function handleEurlexFetch(input: {
  celex_id: string;
  language: string;
  format: 'plain' | 'xhtml';
  max_chars: number;
  offset: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const raw = await sharedCellarClient.fetchDocument(input.celex_id, input.language);
    const { content, truncated, returned_chars, total_chars, offset, next_offset } = processContent(
      raw,
      input.format,
      input.max_chars,
      input.offset,
    );

    const result: FetchResult = {
      celex_id: input.celex_id,
      language: input.language,
      content,
      truncated,
      returned_chars,
      total_chars,
      offset,
      next_offset,
      source_url: `${CELLAR_REST_BASE}/${input.celex_id}`,
    };

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

export function registerFetchTool(server: McpServer): void {
  server.tool(
    'eurlex_fetch',
    "Fetches the full text of an EU legal act by CELEX ID. Paginate long documents with offset and max_chars: pass the previous response's next_offset to continue reading until it is null.",
    fetchSchema.shape,
    {
      title: 'Fetch EU legal act full text',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexFetch(params),
  );
}
