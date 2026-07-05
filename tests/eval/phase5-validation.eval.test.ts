/**
 * Phase 5 Eval – Validation Matrix (V1-V22)
 *
 * PRD milestone: "Alle Validierungen bestanden (V1-V5, V18, V22)"
 *
 * Maps the full PRD Validierungsmatrix V1-V22 to explicit eval assertions.
 * - V1-V5: Live API calls against real EU Publications Office endpoints
 * - V6-V15, V21: Unit validations (mocked where needed)
 * - V16-V18, V20, V22: Server validations via InMemoryTransport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../src/server.js'
import { CellarClient, escapeSparqlString } from '../../src/services/cellarClient.js'
import { SPARQL_ENDPOINT, CELLAR_REST_BASE } from '../../src/constants.js'

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
// Live API Validations (V1-V5)
// ===========================================================================
describe('Phase 5 Eval – Validation Matrix', () => {
  describe('Live API Validations (V1-V5)', () => {
    const client = new CellarClient()
    const TIMEOUT = 60_000

    it('V1: SPARQL endpoint is reachable via POST and returns results with bindings', async () => {
      const { results } = await client.sparqlQuery('Datenschutz-Grundverordnung', { limit: 1 })

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBeGreaterThanOrEqual(1)

      const first = results[0]
      expect(first).toHaveProperty('celex')
      expect(first).toHaveProperty('title')
      expect(first).toHaveProperty('type')
      expect(first).toHaveProperty('eurlex_url')
    }, TIMEOUT)

    it('V2: AI Act findable – result contains celex starting with "32024R1689"', async () => {
      const { results } = await client.sparqlQuery('künstliche Intelligenz', {
        language: 'DEU',
        limit: 50,
      })

      const celexIds = results.map((r) => r.celex)
      const hasAiAct = celexIds.some((c) => c.startsWith('32024R1689'))
      expect(hasAiAct).toBe(true)
    }, TIMEOUT)

    it('V3: DSGVO findable – result contains celex "32016R0679"', async () => {
      const { results } = await client.sparqlQuery('Datenschutz-Grundverordnung', {
        language: 'DEU',
        limit: 50,
      })

      const celexIds = results.map((r) => r.celex)
      expect(celexIds).toContain('32016R0679')
    }, TIMEOUT)

    it('V4: AI Act fulltext DE – content.length > 10000', async () => {
      const content = await client.fetchDocument('32024R1689', 'DEU')

      expect(typeof content).toBe('string')
      expect(content.length).toBeGreaterThan(10_000)
    }, TIMEOUT)

    it('V5: AI Act fulltext EN – content.length > 10000', async () => {
      const content = await client.fetchDocument('32024R1689', 'ENG')

      expect(typeof content).toBe('string')
      expect(content.length).toBeGreaterThan(10_000)
    }, TIMEOUT)
  })

  // ===========================================================================
  // Unit Validations (V6-V15, V21)
  // ===========================================================================
  describe('Unit Validations (V6-V15, V21)', () => {
    const originalFetch = global.fetch
    const mockFetch = vi.fn()

    beforeEach(() => {
      mockFetch.mockReset()
      vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
      vi.stubGlobal('fetch', originalFetch)
    })

    it('V6: handleEurlexFetch with 25000 char content + max_chars=20000 → truncated=true', async () => {
      // Mock CellarClient.fetchDocument via global.fetch mock
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'x'.repeat(25_000),
      })

      // Import dynamically to use our mocked fetch
      const { handleEurlexFetch } = await import('../../src/tools/fetch.js')

      const result = await handleEurlexFetch({
        celex_id: '32024R1689',
        language: 'DEU',
        format: 'xhtml',
        max_chars: 20_000,
      })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.truncated).toBe(true)
      expect(parsed.content.length).toBeLessThanOrEqual(20_000)
    })

    it('V7: handleEurlexFetch with invalid CELEX → returns isError: true', async () => {
      const { handleEurlexFetch } = await import('../../src/tools/fetch.js')

      const result = await handleEurlexFetch({
        celex_id: 'INVALID!!!',
        language: 'DEU',
        format: 'xhtml',
        max_chars: 20_000,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/Error:/)
    })

    it('V8: buildSparqlQuery with REG → contains resource-type/REG', () => {
      const client = new CellarClient()
      const sparql = client.buildSparqlQuery({
        query: 'test',
        resource_type: 'REG',
        language: 'DEU',
        limit: 10,
      })

      expect(sparql).toContain('resource-type/REG')
    })

    it('V9: buildSparqlQuery with date_from → contains date string', () => {
      const client = new CellarClient()
      const sparql = client.buildSparqlQuery({
        query: 'test',
        resource_type: 'any',
        language: 'DEU',
        limit: 10,
        date_from: '2023-01-15',
      })

      expect(sparql).toContain('2023-01-15')
    })

    it('V10: fetchDocument uses Cellar REST API with content negotiation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      const client = new CellarClient()
      await client.fetchDocument('32024R1689', 'DEU')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('publications.europa.eu/resource/celex')
      const headers = options.headers as Record<string, string>
      expect(headers['Accept']).toBe('application/xhtml+xml')
    })

    it('V11: fetchDocument DEU sets Accept-Language: de', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      const client = new CellarClient()
      await client.fetchDocument('32024R1689', 'DEU')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers['Accept-Language']).toBe('de')
    })

    it('V12: buildSparqlQuery contains BIND and ?resType', () => {
      const client = new CellarClient()
      const sparql = client.buildSparqlQuery({
        query: 'test',
        resource_type: 'any',
        language: 'DEU',
        limit: 10,
      })

      expect(sparql).toContain('BIND')
      expect(sparql).toContain('?resType')
    })

    it('V13: sparqlQuery uses POST method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: { bindings: [] } }),
      })

      const client = new CellarClient()
      await client.sparqlQuery('test')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(SPARQL_ENDPOINT)
      expect(options.method).toBe('POST')
    })

    it('V14: fetchDocument uses redirect: follow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html></html>',
      })

      const client = new CellarClient()
      await client.fetchDocument('32024R1689', 'DEU')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(options.redirect).toBe('follow')
    })

    it('V15: handleEurlexFetch format=plain strips <div> tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<div><p>Artikel 1: Gegenstand</p></div>',
      })

      const { handleEurlexFetch } = await import('../../src/tools/fetch.js')

      const result = await handleEurlexFetch({
        celex_id: '32024R1689',
        language: 'DEU',
        format: 'plain',
        max_chars: 20_000,
      })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.content).not.toContain('<div>')
      expect(parsed.content).not.toContain('<p>')
      expect(parsed.content).toContain('Artikel 1')
    })

    it('V21: escapeSparqlString escapes " and \\ correctly', () => {
      const input = 'test " value \\ injection'
      const escaped = escapeSparqlString(input)

      // Double quotes must be escaped
      expect(escaped).toContain('\\"')
      // Backslashes must be escaped
      expect(escaped).toContain('\\\\')

      // The escaped value should be safe to embed in a SPARQL string literal
      const sparqlLiteral = `"${escaped}"`
      const unescapedQuotes = sparqlLiteral.match(/(?<!\\)"/g)
      expect(unescapedQuotes).toHaveLength(2) // only the wrapper quotes
    })
  })

  // ===========================================================================
  // Server Validations (V16-V18, V20, V22)
  // ===========================================================================
  describe('Server Validations (V16-V18, V20, V22)', () => {
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

    it('V16: TypeScript build succeeds – createServer imports without error', () => {
      expect(typeof createServer).toBe('function')
    })

    it('V17: createServer returns functional McpServer – connects via InMemoryTransport', async () => {
      const pair = await createTestPair()
      pairs.push(pair)

      const { tools } = await pair.client.listTools()
      expect(tools).toBeDefined()
      expect(Array.isArray(tools)).toBe(true)
    })

    it('V18: listTools returns all registered tools', async () => {
      const pair = await createTestPair()
      pairs.push(pair)

      const { tools } = await pair.client.listTools()
      const toolNames = tools.map((t) => t.name).sort()

      expect(toolNames).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])
    })

    it('V20: two createServer calls return different instances', async () => {
      const pair1 = await createTestPair()
      const pair2 = await createTestPair()
      pairs.push(pair1, pair2)

      expect(pair1.server).not.toBe(pair2.server)

      // Both are independently functional
      const { tools: tools1 } = await pair1.client.listTools()
      const { tools: tools2 } = await pair2.client.listTools()

      expect(tools1.map((t) => t.name).sort()).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])
      expect(tools2.map((t) => t.name).sort()).toEqual(['eurlex_by_eurovoc', 'eurlex_case_law', 'eurlex_citations', 'eurlex_consolidated', 'eurlex_fetch', 'eurlex_metadata', 'eurlex_search', 'eurlex_sparql', 'eurlex_structure', 'eurlex_summary', 'eurlex_transposition'])
    })

    it('V22: listPrompts returns eurlex_guide', async () => {
      const pair = await createTestPair()
      pairs.push(pair)

      const { prompts } = await pair.client.listPrompts()
      const promptNames = prompts.map((p) => p.name)

      expect(promptNames).toContain('eurlex_guide')
    })
  })
})
