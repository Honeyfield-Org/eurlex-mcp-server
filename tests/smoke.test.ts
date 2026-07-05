import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/server.js'

// ---------------------------------------------------------------------------
// Helper: spin up a server + client pair over in-memory transport
// ---------------------------------------------------------------------------
async function createTestPair() {
  const server = createServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { server, client, clientTransport, serverTransport }
}

// ---------------------------------------------------------------------------
// Phase 5 – Smoke / Capability Tests (no real API calls)
// ---------------------------------------------------------------------------
describe('Phase 5 – Smoke Tests', () => {
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

  // V17: Server startet → createServer() returns a valid McpServer
  it('V17 – createServer() returns a functional McpServer that accepts connections', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    // If we got here without throwing, the server started and accepted a connection.
    // Verify the client can communicate by listing tools (basic protocol handshake succeeded).
    const { tools } = await pair.client.listTools()
    expect(tools).toBeDefined()
    expect(Array.isArray(tools)).toBe(true)
  })

  // V18 + V-NEW-7: server exposes exactly 11 tools (count + names)
  it('V18 – server exposes exactly 11 tools with correct names', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    expect(tools).toHaveLength(11)

    const toolNames = tools.map((t) => t.name).sort()
    expect(toolNames).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])
  })

  // V20: Session-Management → factory creates independent servers per call
  it('V20 – factory creates independent server instances per call', async () => {
    const pair1 = await createTestPair()
    const pair2 = await createTestPair()
    pairs.push(pair1, pair2)

    // Both servers should be operational independently
    const { tools: tools1 } = await pair1.client.listTools()
    const { tools: tools2 } = await pair2.client.listTools()

    expect(tools1.map((t) => t.name).sort()).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])
    expect(tools2.map((t) => t.name).sort()).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])

    // They should be distinct object instances
    expect(pair1.server).not.toBe(pair2.server)
  })

  // Annotations: all tools have title, readOnlyHint: true, destructiveHint:
  // false, idempotentHint: true, openWorldHint: true (Task 5). This exercises
  // the real McpServer/Client round trip (registerXTool → tools/list), which
  // is the authoritative way to confirm the SDK actually surfaces `title`
  // from the annotations object (SDK 1.x supports it — see ToolAnnotations).
  it('eurlex_search has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const search = tools.find((t) => t.name === 'eurlex_search')

    expect(search?.annotations).toBeDefined()
    expect(search?.annotations?.title).toBe('Search EU law by title')
    expect(search?.annotations?.readOnlyHint).toBe(true)
    expect(search?.annotations?.destructiveHint).toBe(false)
    expect(search?.annotations?.idempotentHint).toBe(true)
    expect(search?.annotations?.openWorldHint).toBe(true)
    expect(search?.description).toContain('title')
    expect(search?.description).toContain('eurlex_by_eurovoc')
  })

  it('eurlex_fetch has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const fetch = tools.find((t) => t.name === 'eurlex_fetch')

    expect(fetch?.annotations).toBeDefined()
    expect(fetch?.annotations?.title).toBe('Fetch EU legal act full text')
    expect(fetch?.annotations?.readOnlyHint).toBe(true)
    expect(fetch?.annotations?.destructiveHint).toBe(false)
    expect(fetch?.annotations?.idempotentHint).toBe(true)
    expect(fetch?.annotations?.openWorldHint).toBe(true)
    expect(fetch?.description).toContain('offset')
  })

  it('eurlex_metadata has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const metadata = tools.find((t) => t.name === 'eurlex_metadata')

    expect(metadata?.annotations).toBeDefined()
    expect(metadata?.annotations?.title).toBe('Get EU legal act metadata')
    expect(metadata?.annotations?.readOnlyHint).toBe(true)
    expect(metadata?.annotations?.destructiveHint).toBe(false)
    expect(metadata?.annotations?.idempotentHint).toBe(true)
    expect(metadata?.annotations?.openWorldHint).toBe(true)
    expect(metadata?.description).toContain('legal basis')
    expect(metadata?.description).toContain('authors')
  })

  it('eurlex_by_eurovoc has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const eurovoc = tools.find((t) => t.name === 'eurlex_by_eurovoc')

    expect(eurovoc?.annotations).toBeDefined()
    expect(eurovoc?.annotations?.title).toBe('Search EU law by topic')
    expect(eurovoc?.annotations?.readOnlyHint).toBe(true)
    expect(eurovoc?.annotations?.destructiveHint).toBe(false)
    expect(eurovoc?.annotations?.idempotentHint).toBe(true)
    expect(eurovoc?.annotations?.openWorldHint).toBe(true)
    expect(eurovoc?.description).toContain('EuroVoc')
  })

  it('eurlex_citations has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const citations = tools.find((t) => t.name === 'eurlex_citations')

    expect(citations?.annotations).toBeDefined()
    expect(citations?.annotations?.title).toBe('Find EU legal act citations')
    expect(citations?.annotations?.readOnlyHint).toBe(true)
    expect(citations?.annotations?.destructiveHint).toBe(false)
    expect(citations?.annotations?.idempotentHint).toBe(true)
    expect(citations?.annotations?.openWorldHint).toBe(true)
    expect(citations?.description).toContain('counts')
  })

  it('eurlex_consolidated has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const consolidated = tools.find((t) => t.name === 'eurlex_consolidated')

    expect(consolidated?.annotations).toBeDefined()
    expect(consolidated?.annotations?.title).toBe('Get consolidated EU legal act')
    expect(consolidated?.annotations?.readOnlyHint).toBe(true)
    expect(consolidated?.annotations?.destructiveHint).toBe(false)
    expect(consolidated?.annotations?.idempotentHint).toBe(true)
    expect(consolidated?.annotations?.openWorldHint).toBe(true)
    expect(consolidated?.description).toContain('celex_id')
  })

  it('eurlex_case_law has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const caseLaw = tools.find((t) => t.name === 'eurlex_case_law')

    expect(caseLaw?.annotations).toBeDefined()
    expect(caseLaw?.annotations?.title).toBe('Find CJEU case law')
    expect(caseLaw?.annotations?.readOnlyHint).toBe(true)
    expect(caseLaw?.annotations?.destructiveHint).toBe(false)
    expect(caseLaw?.annotations?.idempotentHint).toBe(true)
    expect(caseLaw?.annotations?.openWorldHint).toBe(true)
    expect(caseLaw?.description).toContain('ECLI')
    expect(caseLaw?.description).toContain('eurlex_search')
  })

  it('eurlex_transposition has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const transposition = tools.find((t) => t.name === 'eurlex_transposition')

    expect(transposition?.annotations).toBeDefined()
    expect(transposition?.annotations?.title).toBe('Find national transposition measures')
    expect(transposition?.annotations?.readOnlyHint).toBe(true)
    expect(transposition?.annotations?.destructiveHint).toBe(false)
    expect(transposition?.annotations?.idempotentHint).toBe(true)
    expect(transposition?.annotations?.openWorldHint).toBe(true)
    expect(transposition?.description).toContain('directive')
    expect(transposition?.description).toContain('NIM')
  })

  it('eurlex_structure has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const structure = tools.find((t) => t.name === 'eurlex_structure')

    expect(structure?.annotations).toBeDefined()
    expect(structure?.annotations?.title).toBe('Outline an EU act and locate its articles')
    expect(structure?.annotations?.readOnlyHint).toBe(true)
    expect(structure?.annotations?.destructiveHint).toBe(false)
    expect(structure?.annotations?.idempotentHint).toBe(true)
    expect(structure?.annotations?.openWorldHint).toBe(true)
    // Description explains the structure → offset → fetch workflow.
    expect(structure?.description).toContain('offset')
    expect(structure?.description).toContain('eurlex_fetch')
  })

  it('eurlex_summary has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const summary = tools.find((t) => t.name === 'eurlex_summary')

    expect(summary?.annotations).toBeDefined()
    expect(summary?.annotations?.title).toBe('Get the plain-language summary of an EU act')
    expect(summary?.annotations?.readOnlyHint).toBe(true)
    expect(summary?.annotations?.destructiveHint).toBe(false)
    expect(summary?.annotations?.idempotentHint).toBe(true)
    expect(summary?.annotations?.openWorldHint).toBe(true)
    expect(summary?.description).toContain('LEGISSUM')
    expect(summary?.description).toContain('eurlex_fetch')
  })

  it('eurlex_sparql has title, full annotation set, and a self-contained description', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { tools } = await pair.client.listTools()
    const sparql = tools.find((t) => t.name === 'eurlex_sparql')

    expect(sparql?.annotations).toBeDefined()
    expect(sparql?.annotations?.title).toBe('Run a raw read-only SPARQL query')
    expect(sparql?.annotations?.readOnlyHint).toBe(true)
    expect(sparql?.annotations?.destructiveHint).toBe(false)
    expect(sparql?.annotations?.idempotentHint).toBe(true)
    expect(sparql?.annotations?.openWorldHint).toBe(true)
    // Description names the escape-hatch nature and points at the guide.
    expect(sparql?.description).toContain('SELECT')
    expect(sparql?.description).toContain('eurlex_guide')
  })

  // V22: eurlex_guide Prompt abrufbar → server has eurlex_guide prompt registered
  it('V22 – server exposes eurlex_guide prompt', async () => {
    const pair = await createTestPair()
    pairs.push(pair)

    const { prompts } = await pair.client.listPrompts()
    const promptNames = prompts.map((p) => p.name)

    expect(promptNames).toContain('eurlex_guide')
  })
})
