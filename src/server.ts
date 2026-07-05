import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGuidePrompt } from './prompts/guide.js';
import { registerCaseLawTool } from './tools/caseLaw.js';
import { registerCitationsTool } from './tools/citations.js';
import { registerConsolidatedTool } from './tools/consolidated.js';
import { registerEurovocTool } from './tools/eurovoc.js';
import { registerFetchTool } from './tools/fetch.js';
import { registerMetadataTool } from './tools/metadata.js';
import { registerSearchTool } from './tools/search.js';
import { registerSparqlTool } from './tools/sparql.js';
import { registerStructureTool } from './tools/structure.js';
import { registerSummaryTool } from './tools/summary.js';
import { registerTranspositionTool } from './tools/transposition.js';
import { VERSION } from './version.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'eurlex-mcp-server',
    version: VERSION,
  });

  registerSearchTool(server);
  registerFetchTool(server);
  registerMetadataTool(server);
  registerCitationsTool(server);
  registerEurovocTool(server);
  registerConsolidatedTool(server);
  registerCaseLawTool(server);
  registerTranspositionTool(server);
  registerStructureTool(server);
  registerSummaryTool(server);
  registerSparqlTool(server);
  registerGuidePrompt(server);

  return server;
}
