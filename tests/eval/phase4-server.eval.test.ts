import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Helper: spin up a server + client pair over in-memory transport
// ---------------------------------------------------------------------------
async function createTestPair() {
  const server = createServer()
  const client = new Client({ name: 'eval-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { server, client, clientTransport, serverTransport }
}

// ===========================================================================
// Phase 4 Eval – Server
// PRD milestone: "pnpm run build erfolgreich, /health antwortet"
// ===========================================================================
describe('Phase 4 Eval – Server', () => {
  const pairs: Array<{ client: Client; clientTransport: any; serverTransport: any }> = []

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

  it('createServer is exported from src/index.ts and returns an McpServer', async () => {
    expect(typeof createServer).toBe('function')

    const server = createServer()
    expect(server).toBeDefined()
    expect(typeof server.connect).toBe('function')
  })

  it('createServer factory creates distinct instances per call', () => {
    const server1 = createServer()
    const server2 = createServer()

    expect(server1).not.toBe(server2)
  })

  it('server registers exactly 5 tools: eurlex_by_eurovoc, eurlex_citations, eurlex_search, eurlex_fetch, eurlex_metadata', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const toolNames = tools.map((t) => t.name).sort()

    expect(tools).toHaveLength(6)
    expect(toolNames).toEqual(['eurlex_by_eurovoc', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search'])
  })

  it('eurlex_search has annotations readOnlyHint=true, destructiveHint=false', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const search = tools.find((t) => t.name === 'eurlex_search')

    expect(search?.annotations).toBeDefined()
    expect(search?.annotations?.readOnlyHint).toBe(true)
    expect(search?.annotations?.destructiveHint).toBe(false)
  })

  it('eurlex_fetch has annotations readOnlyHint=true, destructiveHint=false', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const fetch = tools.find((t) => t.name === 'eurlex_fetch')

    expect(fetch?.annotations).toBeDefined()
    expect(fetch?.annotations?.readOnlyHint).toBe(true)
    expect(fetch?.annotations?.destructiveHint).toBe(false)
  })

  it('server registers eurlex_guide prompt', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { prompts } = await pair.client.listPrompts()
    const promptNames = prompts.map((p) => p.name)

    expect(promptNames).toContain('eurlex_guide')
  })

  it('eurlex_guide prompt returns content with CELEX guide text', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const result = await pair.client.getPrompt({ name: 'eurlex_guide', arguments: {} })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')

    const text = result.messages[0].content as { type: string; text: string }
    expect(text.text).toContain('CELEX')
    expect(text.text).toContain('Search strategy')
    expect(text.text).toContain('32024R1689')
  })
})
