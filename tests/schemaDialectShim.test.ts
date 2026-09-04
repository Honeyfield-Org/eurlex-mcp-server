import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createServer } from '../src/server.js'
import {
  stripSchemaDialect,
  withStrippedSchemaDialect,
} from '../src/services/schemaDialectShim.js'

// ---------------------------------------------------------------------------
// stripSchemaDialect — pure message transform
// ---------------------------------------------------------------------------
describe('stripSchemaDialect', () => {
  it('removes $schema from inputSchema and outputSchema of every tool in a tools/list result', () => {
    const input: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'a',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
              properties: { x: { type: 'string' } },
            },
            outputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
            },
          },
          {
            name: 'b',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
            },
          },
        ],
      },
    }

    const output = stripSchemaDialect(input)

    const result = (output as unknown as { result: { tools: Array<Record<string, unknown>> } })
      .result
    const toolA = result.tools[0]
    const toolB = result.tools[1]

    const inputSchemaA = toolA.inputSchema as Record<string, unknown>
    const outputSchemaA = toolA.outputSchema as Record<string, unknown>

    expect(inputSchemaA.$schema).toBeUndefined()
    expect(outputSchemaA.$schema).toBeUndefined()
    expect(inputSchemaA.type).toBe('object')
    expect(inputSchemaA.properties).toEqual({ x: { type: 'string' } })
    expect(outputSchemaA.type).toBe('object')
    expect(toolA.name).toBe('a')

    expect(toolB.name).toBe('b')
    expect('outputSchema' in toolB).toBe(false)
    const inputSchemaB = toolB.inputSchema as Record<string, unknown>
    expect(inputSchemaB.$schema).toBeUndefined()
    expect(inputSchemaB.type).toBe('object')

    expect((output as { id?: unknown }).id).toBe(1)
    expect(output.jsonrpc).toBe('2.0')
  })

  it('does not mutate the input message', () => {
    const input: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'a',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
            },
            outputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
            },
          },
        ],
      },
    }
    const before = JSON.stringify(input)

    const output = stripSchemaDialect(input)

    expect(JSON.stringify(input)).toBe(before)
    expect(output).not.toBe(input)
  })

  it('returns the same reference for messages that are not tools/list results', () => {
    const request: JSONRPCMessage = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const notification: JSONRPCMessage = { jsonrpc: '2.0', method: 'notifications/initialized' }
    const errorResponse: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'x' },
    }
    const resultWithoutTools: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: { prompts: [] },
    }

    expect(stripSchemaDialect(request)).toBe(request)
    expect(stripSchemaDialect(notification)).toBe(notification)
    expect(stripSchemaDialect(errorResponse)).toBe(errorResponse)
    expect(stripSchemaDialect(resultWithoutTools)).toBe(resultWithoutTools)
  })

  it('leaves tools/list results untouched when no schema declares $schema', () => {
    const input: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'a',
            inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
            outputSchema: { type: 'object' },
          },
        ],
      },
    }

    const output = stripSchemaDialect(input)

    expect(output).toEqual(input)
  })
})

// ---------------------------------------------------------------------------
// withStrippedSchemaDialect — end-to-end over the real server
// ---------------------------------------------------------------------------
describe('withStrippedSchemaDialect', () => {
  const pairs: Array<{ clientTransport: { close: () => Promise<void> }; serverTransport: { close: () => Promise<void> } }> = []

  afterEach(async () => {
    for (const pair of pairs) {
      try {
        await pair.clientTransport.close()
        await pair.serverTransport.close()
      } catch {
        // ignore cleanup errors
      }
    }
    pairs.length = 0
  })

  it('tools/list over a wrapped transport carries no $schema on any tool', async () => {
    const server = createServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    pairs.push({ clientTransport, serverTransport })

    await server.connect(withStrippedSchemaDialect(serverTransport))
    await client.connect(clientTransport)

    const { tools } = await client.listTools()

    expect(tools).toHaveLength(11)
    for (const tool of tools) {
      const inputSchema = tool.inputSchema as Record<string, unknown> | undefined
      const outputSchema = tool.outputSchema as Record<string, unknown> | undefined

      expect(inputSchema?.$schema, `${tool.name} inputSchema.$schema`).toBeUndefined()
      expect(outputSchema, `${tool.name} outputSchema`).toBeDefined()
      expect(outputSchema?.$schema, `${tool.name} outputSchema.$schema`).toBeUndefined()
      expect(outputSchema?.type).toBe('object')
    }
  })

  // Control: if this test starts failing because the SDK no longer emits
  // draft-07 $schema stamps, the shim (and this whole test file) can be removed.
  it('control: an unwrapped transport still declares draft-07 (documents why the shim exists)', async () => {
    const server = createServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    pairs.push({ clientTransport, serverTransport })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()

    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      const inputSchema = tool.inputSchema as Record<string, unknown>
      const outputSchema = tool.outputSchema as Record<string, unknown> | undefined

      expect(inputSchema.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(outputSchema?.$schema).toBe('http://json-schema.org/draft-07/schema#')
    }
  })

  it('returns the same transport instance', () => {
    const [, serverTransport] = InMemoryTransport.createLinkedPair()
    pairs.push({
      clientTransport: { close: () => Promise.resolve() },
      serverTransport,
    })

    expect(withStrippedSchemaDialect(serverTransport)).toBe(serverTransport)
  })
})
