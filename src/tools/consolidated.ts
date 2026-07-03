import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { consolidatedInputSchema, consolidatedSchema } from '../schemas/consolidatedSchema.js';
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

// Sector-3 secondary-law CELEX pattern: 3 (sector) + YYYY (year) + R|L|D
// (type letter) + NNNN+ (document number). Used to derive doc_type/year/number
// from a celex_id input — the alternative to doc_type + year + number.
const SECTOR3_CELEX_REGEX = /^3(\d{4})([RLD])(\d+)$/;
const TYPE_LETTER_TO_DOC_TYPE: Record<string, 'reg' | 'dir' | 'dec'> = {
  R: 'reg',
  L: 'dir',
  D: 'dec',
};

function deriveFromCelex(celexId: string): { docType: string; year: number; number: number } {
  const match = SECTOR3_CELEX_REGEX.exec(celexId);
  if (!match) {
    throw new Error(
      `celex_id "${celexId}" is not a sector-3 secondary-law CELEX. Expected format 3YYYY[R|L|D]NNNN, e.g. "32016R0679" (GDPR: R=regulation, L=directive, D=decision). Use doc_type/year/number instead, or eurlex_fetch/eurlex_metadata for other sectors.`,
    );
  }
  const [, yearStr, typeLetter, numberStr] = match;
  return {
    docType: TYPE_LETTER_TO_DOC_TYPE[typeLetter],
    year: Number(yearStr),
    number: Number(numberStr),
  };
}

export async function handleEurlexConsolidated(input: {
  celex_id?: string;
  doc_type?: string;
  year?: number;
  number?: number;
  language: string;
  format: 'plain' | 'xhtml';
  max_chars: number;
  offset: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    // `server.tool(consolidatedSchema.shape)` only registers the per-field
    // shape with the SDK — the celex_id XOR doc_type+year+number invariant is
    // an object-level refinement that gets stripped in that process. Re-parse
    // against the refined schema here so the invariant is actually enforced.
    const parsed = consolidatedInputSchema.parse(input);

    let docType: string;
    let year: number;
    let number: number;
    if (parsed.celex_id) {
      const derived = deriveFromCelex(parsed.celex_id);
      docType = derived.docType;
      year = derived.year;
      number = derived.number;
    } else {
      // Guaranteed defined here by the XOR refinement above.
      docType = parsed.doc_type as string;
      year = parsed.year as number;
      number = parsed.number as number;
    }

    const client = new CellarClient();
    const {
      content: rawContent,
      eliUrl,
      consolidatedCelex,
    } = await client.fetchConsolidated(docType, year, number, parsed.language);

    const { content, truncated, returned_chars, total_chars, offset, next_offset } = processContent(
      rawContent,
      parsed.format,
      parsed.max_chars,
      parsed.offset,
    );

    const result: ConsolidatedResult = {
      doc_type: docType,
      year,
      number,
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
    'Fetches the latest consolidated (currently in-force) version of an EU legal act via ELI, with all amendments merged in. Identify the act with celex_id (e.g. "32016R0679") OR with doc_type + year + number — provide exactly one of the two. celex_id must be a sector-3 secondary-law CELEX (3YYYY[R|L|D]NNNN).',
    consolidatedSchema.shape,
    {
      title: 'Get consolidated EU legal act',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexConsolidated(params),
  );
}
