import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { caseLawSchema, caseLawInputSchema } from '../schemas/caseLawSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import { toolError } from '../utils.js';

export async function handleEurlexCaseLaw(input: {
  query?: string;
  celex_id?: string;
  ecli?: string;
  related_celex?: string;
  court: string;
  type: string;
  language: string;
  limit: number;
  date_from?: string;
  date_to?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    // `server.tool(caseLawSchema.shape)` registers only the per-field shape; the
    // "at least one of query/celex_id/ecli/related_celex" rule is an object-level
    // refinement stripped there. Re-parse against the refined schema to enforce it.
    const parsed = caseLawInputSchema.parse(input);

    const result = await sharedCellarClient.caseLawQuery({
      query: parsed.query,
      celex_id: parsed.celex_id,
      ecli: parsed.ecli,
      related_celex: parsed.related_celex,
      court: parsed.court,
      type: parsed.type,
      language: parsed.language,
      limit: parsed.limit,
      date_from: parsed.date_from,
      date_to: parsed.date_to,
    });

    if (result.results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No case law found for the given criteria.' }],
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerCaseLawTool(server: McpServer): void {
  server.tool(
    'eurlex_case_law',
    'Finds Court of Justice of the EU (CJEU) case law — judgments (JUDG), orders (ORDER), and Advocate General opinions (OPIN_AG) of the Court of Justice and the General Court. Look up rulings four ways (at least one required, combinable): query=title/party substring (e.g. "Schrems"), celex_id=a sector-6 CELEX (e.g. "62012CJ0131"), ecli=a European Case Law Identifier (e.g. "ECLI:EU:C:2014:317"), or related_celex=a legal act\'s CELEX (e.g. "32016R0679") to get the case law interpreting that act. Narrow with court (COURT_JUSTICE/GENERAL_COURT), type, language, and date_from/date_to. Unlike eurlex_search (which searches legislation by title), this tool is scoped to case law and understands ECLIs and act-to-case-law relations. Each hit returns celex, ecli, title, date, type, and eurlex_url.',
    caseLawSchema.shape,
    {
      title: 'Find CJEU case law',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (params) => handleEurlexCaseLaw(params),
  );
}
