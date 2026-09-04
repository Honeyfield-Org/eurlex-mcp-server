import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Workaround for GitHub issue #49 — remove once the SDK v2 migration (#50) lands.
 *
 * MCP SDK v1 (Zod 3 path) stamps `"$schema": "http://json-schema.org/draft-07/schema#"` on
 * every tool's inputSchema/outputSchema and exposes no option to change or drop it. The
 * pre-release v2 MCP client (`@modelcontextprotocol/client` 2.0.0-alpha/beta, bundled in Claude
 * Desktop / Cowork / Claude Code as of 2026-09) rejects any outputSchema whose `$schema` is not
 * 2020-12 (modelcontextprotocol/typescript-sdk#2532; relaxed in 2.0.0 via #2534).
 *
 * Per the MCP spec a schema without `$schema` is read as 2020-12. Our schemas only use keywords
 * that are identical in draft-07 and 2020-12 (no `$ref`, `definitions`, tuples, or `format`),
 * so dropping the key is safe for every client, old and new.
 */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutDialect(schema: unknown): unknown {
  if (!isObject(schema) || !('$schema' in schema)) return schema;
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

/**
 * If `message` is a `tools/list` result, returns a copy with `$schema` removed from every
 * tool's inputSchema/outputSchema. Any other message is returned unchanged (same reference).
 */
export function stripSchemaDialect(message: JSONRPCMessage): JSONRPCMessage {
  if (!('result' in message) || !isObject(message.result) || !Array.isArray(message.result.tools)) {
    return message;
  }
  const tools = message.result.tools.map((tool: unknown) => {
    if (!isObject(tool)) return tool;
    const stripped: JsonObject = { ...tool };
    if ('inputSchema' in tool) stripped.inputSchema = withoutDialect(tool.inputSchema);
    if ('outputSchema' in tool) stripped.outputSchema = withoutDialect(tool.outputSchema);
    return stripped;
  });
  return { ...message, result: { ...message.result, tools } };
}

/** Wraps `transport.send` so every outgoing `tools/list` result passes through `stripSchemaDialect`. */
export function withStrippedSchemaDialect<T extends Transport>(transport: T): T {
  const send = transport.send.bind(transport);
  transport.send = (message, options): Promise<void> => send(stripSchemaDialect(message), options);
  return transport;
}
