import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { consolidatedSchema } from '../schemas/consolidatedSchema.js';
import { CellarClient } from '../services/cellarClient.js';
import type { ConsolidatedResult } from '../types.js';
import { processContent, toolError } from '../utils.js';

/**
 * Parses the "-YYYYMMDD" consolidation-date suffix off a consolidated CELEX
 * ID, e.g. "02016R0679-20160504" -> "2016-05-04". Returns `null` when the
 * CELEX has no such suffix.
 */
function parseConsolidationDate(consolidatedCelex: string): string | null {
  const match = /-(\d{4})(\d{2})(\d{2})$/.exec(consolidatedCelex);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

export async function handleEurlexConsolidated(input: {
  doc_type: string;
  year: number;
  number: number;
  language: string;
  format: 'plain' | 'xhtml';
  max_chars: number;
  offset: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const parsed = consolidatedSchema.parse(input);

    const client = new CellarClient();
    const {
      content: rawContent,
      eliUrl,
      consolidatedCelex,
    } = await client.fetchConsolidated(
      parsed.doc_type,
      parsed.year,
      parsed.number,
      parsed.language,
    );

    const { content, truncated, returned_chars, total_chars, offset, next_offset } = processContent(
      rawContent,
      parsed.format,
      parsed.max_chars,
      parsed.offset,
    );

    const result: ConsolidatedResult = {
      doc_type: parsed.doc_type,
      year: parsed.year,
      number: parsed.number,
      language: parsed.language,
      content,
      truncated,
      returned_chars,
      total_chars,
      offset,
      next_offset,
      eli_url: eliUrl,
      consolidated_celex: consolidatedCelex,
      consolidation_date: parseConsolidationDate(consolidatedCelex),
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

export function registerConsolidatedTool(server: McpServer): void {
  server.tool(
    'eurlex_consolidated',
    'Ruft die konsolidierte (aktuell gültige) Fassung eines EU-Rechtsakts ab via ELI',
    consolidatedSchema.shape,
    { readOnlyHint: true, destructiveHint: false },
    async (params) => handleEurlexConsolidated(params),
  );
}
