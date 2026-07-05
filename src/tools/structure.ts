import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CELLAR_REST_BASE } from '../constants.js';
import {
  structureInputSchema,
  structureSchema,
  structureOutputSchema,
} from '../schemas/structureSchema.js';
import { sharedCellarClient } from '../services/cellarClient.js';
import type { StructureResult, ToolResult } from '../types.js';
import { parseOutline, stripHtml, toCallToolResult, toolError } from '../utils.js';

/** Cap on outline entries returned; total_headings still reports the full count. */
const OUTLINE_MAX_ENTRIES = 300;

export async function handleEurlexStructure(input: {
  celex_id?: string;
  eli?: string;
  oj_ref?: string;
  language: string;
}): Promise<ToolResult<StructureResult>> {
  try {
    // `server.tool(structureSchema.shape)` strips the object-level XOR refinement;
    // re-parse against the refined schema so "exactly one identifier" is enforced.
    const parsed = structureInputSchema.parse(input);

    const celexId = await sharedCellarClient.resolveCelexId(parsed);
    const raw = await sharedCellarClient.fetchDocument(celexId, parsed.language);

    // Outline the SAME plain text eurlex_fetch(format:"plain") slices — stripHtml(raw)
    // is exactly what processContent(raw,'plain',…) measures — so every heading offset
    // is a valid entry point for eurlex_fetch(offset). This coupling is the point of
    // the tool and is proven in tests/outline.test.ts.
    const plain = stripHtml(raw);
    const { entries, total, truncated } = parseOutline(plain, OUTLINE_MAX_ENTRIES);

    const result: StructureResult = {
      celex_id: celexId,
      language: parsed.language,
      total_headings: total,
      returned: entries.length,
      truncated,
      total_chars: plain.length,
      outline: entries,
      source_url: `${CELLAR_REST_BASE}/${celexId}`,
    };

    if (entries.length === 0) {
      result.note =
        'No chapter/section/article/annex headings were detected. The document may be ' +
        'unstructured (e.g. a short decision), available only as PDF, or in a language whose ' +
        'heading words are not recognized (recognition covers EN, DE and FR — try language:"ENG"). ' +
        'The full text is still readable with eurlex_fetch.';
    } else if (truncated) {
      result.note = `Outline truncated to ${OUTLINE_MAX_ENTRIES} of ${total} headings.`;
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerStructureTool(server: McpServer): void {
  server.registerTool(
    'eurlex_structure',
    {
      description:
        'Returns the outline (table of contents) of an EU legal act — its chapters, sections, articles and annexes — each with a character offset into the document\'s plain text. Use it as a map for targeted reading: read an article\'s offset from the outline, then call eurlex_fetch(celex_id, format:"plain", offset, max_chars) with that offset to jump straight to that article instead of paging from the top of a long act. Identify the act by celex_id (e.g. "32024R1689"), eli, or oj_ref — provide exactly one. Each outline entry has: level (1=part/title/annex, 2=chapter, 3=section, 4=article), label (e.g. "Article 5", "CHAPTER III"), title (the heading\'s subtitle, e.g. "Prohibited AI practices"), and offset. total_headings is the full count; the returned list is capped at 300 for very large acts (truncated=true). Heading offsets are specific to the chosen language and to plain (tag-stripped) text — pass the SAME language to the follow-up eurlex_fetch call and keep format:"plain". Heading recognition covers English, German and French documents.',
      inputSchema: structureSchema.shape,
      outputSchema: structureOutputSchema.shape,
      annotations: {
        title: 'Outline an EU act and locate its articles',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => toCallToolResult(await handleEurlexStructure(params)),
  );
}
