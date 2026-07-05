import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CELLAR_REST_BASE } from '../constants.js';
import { fetchSchema, fetchInputSchema, fetchOutputSchema } from '../schemas/fetchSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { FetchResult, ToolResult } from '../types.js';
import { processContent, toCallToolResult, toolError } from '../utils.js';

export async function handleEurlexFetch(input: {
  celex_id?: string;
  eli?: string;
  oj_ref?: string;
  language: string;
  format: 'plain' | 'xhtml';
  max_chars: number;
  offset: number;
}): Promise<ToolResult<FetchResult>> {
  try {
    // `server.tool(fetchSchema.shape)` registers only the per-field shape; the
    // "exactly one of celex_id/eli/oj_ref" XOR is an object-level refinement that
    // gets stripped there. Re-parse against the refined schema so it is enforced.
    const parsed = fetchInputSchema.parse(input);

    // Resolve whichever identifier was given to a CELEX ID (celex_id passes
    // through with no network call; eli/oj_ref are looked up via SPARQL).
    const celexId = await sharedCellarClient.resolveCelexId(parsed);

    const raw = await sharedCellarClient.fetchDocument(celexId, parsed.language);
    const { content, truncated, returned_chars, total_chars, offset, next_offset } = processContent(
      raw,
      parsed.format,
      parsed.max_chars,
      parsed.offset,
    );

    const result: FetchResult = {
      celex_id: celexId,
      language: parsed.language,
      content,
      truncated,
      returned_chars,
      total_chars,
      offset,
      next_offset,
      source_url: `${CELLAR_REST_BASE}/${celexId}`,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerFetchTool(server: McpServer): void {
  server.registerTool(
    'eurlex_fetch',
    {
      description:
        'Fetches the full text of an EU legal act. Identify it by celex_id (e.g. "32024R1689"), by eli (e.g. "reg/2016/679" or a full ELI URL), or by oj_ref (post-2023 Official Journal reference, e.g. "OJ:L_202401689") — provide exactly one. Paginate long documents with offset and max_chars: pass the previous response\'s next_offset to continue reading until it is null.',
      inputSchema: fetchSchema.shape,
      outputSchema: fetchOutputSchema.shape,
      annotations: {
        title: 'Fetch EU legal act full text',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexFetch(params)),
  );
}
