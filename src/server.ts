import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGuidePrompt } from './prompts/guide.js';
import { registerCitationsTool } from './tools/citations.js';
import { registerConsolidatedTool } from './tools/consolidated.js';
import { registerEurovocTool } from './tools/eurovoc.js';
import { registerFetchTool } from './tools/fetch.js';
import { registerMetadataTool } from './tools/metadata.js';
import { registerSearchTool } from './tools/search.js';
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
  registerGuidePrompt(server);

  return server;
}
