#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';
import { withStrippedSchemaDialect } from './services/schemaDialectShim.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = withStrippedSchemaDialect(new StdioServerTransport());
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start EUR-Lex MCP server:', error);
  process.exit(1);
});
