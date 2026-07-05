import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { EURLEX_BASE } from '../constants.js';
import { LANGUAGE_ISO_MAP } from '../languages.js';
import { summarySchema, summaryOutputSchema } from '../schemas/summarySchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { SummaryMeta, SummaryNotFound, SummaryResult, ToolResult } from '../types.js';
import { processContent, toCallToolResult, toolError } from '../utils.js';

/** Cap on the `other_summaries` list so the response stays compact for the rare
 *  acts (treaty articles, framework communications) that have dozens of summaries. */
const OTHER_SUMMARIES_CAP = 20;

/**
 * Picks the single summary to return when an act has several LEGISSUM summaries.
 * Deterministic ranking: non-obsolete before obsolete, then newest date first
 * (an empty date sorts last), then highest legissum_id as a stable tie-breaker.
 * Returns null for an empty list. Pure — unit-tested without any network.
 */
export function selectPrimarySummary(summaries: SummaryMeta[]): SummaryMeta | null {
  if (summaries.length === 0) return null;
  const ranked = [...summaries].sort((a, b) => {
    if (a.obsolete !== b.obsolete) return a.obsolete ? 1 : -1;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first; '' sorts last
    return a.legissum_id < b.legissum_id ? 1 : -1;
  });
  return ranked[0];
}

export async function handleEurlexSummary(input: {
  celex_id: string;
  language: string;
  max_chars: number;
  offset: number;
}): Promise<ToolResult<SummaryResult | SummaryNotFound>> {
  try {
    const summaries = await sharedCellarClient.findSummaries(input.celex_id, input.language);

    if (summaries.length === 0) {
      // Not an error — a legitimate "no summary" outcome. total_summaries:0 is
      // the discriminator; the summary-content fields are absent (optional in
      // summaryOutputSchema), so this still satisfies the output schema.
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `No LEGISSUM summary is available for ${input.celex_id}. ` +
              'The EU publishes plain-language summaries for several thousand major acts, ' +
              'but many acts have none. Use eurlex_fetch for the full legal text or ' +
              'eurlex_metadata for structured metadata.',
          },
        ],
        structuredContent: {
          celex_id: input.celex_id,
          language: input.language,
          total_summaries: 0,
        },
      };
    }

    // A non-null primary is guaranteed here (summaries is non-empty).
    const primary = selectPrimarySummary(summaries) as SummaryMeta;
    const raw = await sharedCellarClient.fetchSummaryDocument(primary.uri, input.language);

    const { content, truncated, returned_chars, total_chars, offset, next_offset } = processContent(
      raw,
      'plain',
      input.max_chars,
      input.offset,
    );

    const iso = LANGUAGE_ISO_MAP[input.language] ?? 'en';
    const result: SummaryResult = {
      celex_id: input.celex_id,
      language: input.language,
      legissum_id: primary.legissum_id,
      title: primary.title,
      date: primary.date,
      obsolete: primary.obsolete,
      content,
      truncated,
      returned_chars,
      total_chars,
      offset,
      next_offset,
      total_summaries: summaries.length,
      source_url: `${EURLEX_BASE}/${iso}/LSU/?uri=CELEX:${input.celex_id}`,
    };

    const others = summaries.filter((s) => s.uri !== primary.uri);
    if (others.length > 0) {
      result.other_summaries = others.slice(0, OTHER_SUMMARIES_CAP).map((s) => ({
        legissum_id: s.legissum_id,
        title: s.title,
        date: s.date,
        obsolete: s.obsolete,
      }));
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerSummaryTool(server: McpServer): void {
  server.registerTool(
    'eurlex_summary',
    {
      description:
        'Returns the EU\'s official plain-language summary (LEGISSUM) of a legal act — a short editorial overview written for non-lawyers ("what is the aim", "key points", "from when does it apply"), NOT the binding legal text. Input is the act\'s celex_id (e.g. "32016R0679" for the GDPR, "32022R2065" for the Digital Services Act) and a language (any of the 24 official EU languages; summaries are usually available in all of them). Output is the summary text (plain, HTML stripped) plus its LEGISSUM id, title, last-update date, an obsolete flag, and source_url (the EUR-Lex summary page). Long summaries paginate via max_chars/offset exactly like eurlex_fetch — pass the previous response\'s next_offset to continue. Several thousand major acts have a summary; many acts have none (you get a clear "no summary" message). When an act has several summaries the most current non-obsolete one is returned and the rest are listed in other_summaries. For the full legal text use eurlex_fetch; for structured metadata use eurlex_metadata.',
      inputSchema: summarySchema.shape,
      outputSchema: summaryOutputSchema.shape,
      annotations: {
        title: 'Get the plain-language summary of an EU act',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexSummary(params)),
  );
}
