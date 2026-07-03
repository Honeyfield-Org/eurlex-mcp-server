import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SPARQL_ENDPOINT, CELLAR_REST_BASE } from '../src/constants.js'
import { CellarClient, escapeSparqlString } from '../src/services/cellarClient.js'

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

// ---------------------------------------------------------------------------
// Helper to build a SPARQL JSON response body
// ---------------------------------------------------------------------------
function makeSparqlResponse(bindings: Array<{ work: string; celex: string; title: string; date: string; resType: string }>) {
  return {
    results: {
      bindings: bindings.map(b => ({
        work: { type: 'uri', value: b.work },
        celex: { type: 'literal', value: b.celex },
        title: { type: 'literal', value: b.title },
        date: { type: 'literal', value: b.date },
        resType: { type: 'literal', value: b.resType },
      })),
    },
  }
}

// ===========================================================================
// Tests 1-5: sparqlQuery()
// ===========================================================================
describe('sparqlQuery()', () => {
  it('T1 – returns CELEX-IDs, title, and type from SPARQL response', async () => {
    const body = makeSparqlResponse([
      { work: 'http://publications.europa.eu/resource/cellar/uuid1', celex: '32021R0694', title: 'Regulation on X', date: '2021-05-01', resType: 'REG' },
      { work: 'http://publications.europa.eu/resource/cellar/uuid2', celex: '32020L0123', title: 'Directive on Y', date: '2020-03-15', resType: 'DIR' },
    ])

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('test query')

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      celex: '32021R0694',
      title: 'Regulation on X',
      type: 'REG',
    })
    expect(results[1]).toMatchObject({
      celex: '32020L0123',
      title: 'Directive on Y',
      type: 'DIR',
    })
  })

  it('T2 – returns empty array when no results', async () => {
    const body = makeSparqlResponse([])

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('xyznonexistent123')
    expect(results).toEqual([])
  })

  it('T3 – throws error on HTTP 500 (after exhausting retries)', async () => {
    // 5xx is retryable: 1 initial attempt + 2 retries = 3 total calls
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.sparqlQuery('test')).rejects.toThrow('SPARQL endpoint error: 500')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('T4 – throws error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const client = new CellarClient()
    await expect(client.sparqlQuery('test')).rejects.toThrow('Network error')
  })

  it('T5 – sends SPARQL query via POST with Content-Type application/sparql-query', async () => {
    const body = makeSparqlResponse([])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    })

    const client = new CellarClient()
    await client.sparqlQuery('test')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(SPARQL_ENDPOINT)
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
    })
  })
})

// ===========================================================================
// Tests 6-9: fetchDocument()
// ===========================================================================
describe('fetchDocument()', () => {
  it('T6 – returns XHTML content for valid CELEX-ID', async () => {
    const xhtmlContent = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Article 1</p></body></html>'

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => xhtmlContent,
    })

    const client = new CellarClient()
    const result = await client.fetchDocument('32021R0694', 'DEU')
    expect(result).toBe(xhtmlContent)
  })

  it('T7 – throws error for unknown CELEX-ID (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    const client = new CellarClient()
    await expect(client.fetchDocument('00000X0000', 'DEU')).rejects.toThrow('Document not found: 00000X0000. The document may not be available in electronic full-text format on EUR-Lex.')
  })

  it('T8 – uses Cellar REST URL with content negotiation headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    })

    const client = new CellarClient()
    await client.fetchDocument('32021R0694', 'ENG')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toBe('https://publications.europa.eu/resource/celex/32021R0694')

    const headers = options.headers as Record<string, string>
    expect(headers['Accept']).toBe('application/xhtml+xml')
    expect(headers['Accept-Language']).toBe('en')
  })

  it('T9 – maps DEU to de in Accept-Language header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    })

    const client = new CellarClient()
    await client.fetchDocument('32021R0694', 'DEU')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['Accept-Language']).toBe('de')
  })
})

// ===========================================================================
// Tests 10-14: buildSparqlQuery()
// ===========================================================================
describe('buildSparqlQuery()', () => {
  const baseParams = {
    query: 'carbon border adjustment',
    resource_type: 'any',
    language: 'DEU',
    limit: 10,
  }

  it('T10 – includes REG filter when resource_type=REG', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({ ...baseParams, resource_type: 'REG' })

    expect(sparql).toContain('resource-type/REG')
    expect(sparql).toContain('SELECT')
  })

  it('T11 – has no type filter when resource_type=any', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({ ...baseParams, resource_type: 'any' })

    expect(sparql).toContain('SELECT')
    // Should not contain a specific resource-type filter URI
    expect(sparql).not.toContain('resource-type/REG')
    expect(sparql).not.toContain('resource-type/DIR')
    expect(sparql).not.toContain('resource-type/DEC')
  })

  it('T12 – includes date filter when date_from is set', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({ ...baseParams, date_from: '2021-01-01' })

    expect(sparql).toContain('2021-01-01')
    expect(sparql).toMatch(/FILTER/)
  })

  it('T13 – contains BIND for resType extraction', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery(baseParams)

    expect(sparql).toMatch(/BIND/)
    expect(sparql).toContain('resType')
  })

  it('T14 – title triple is required, not OPTIONAL', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery(baseParams)

    // Title must appear in the query
    expect(sparql).toContain('expression_title ?title')
    // Title must NOT be inside an OPTIONAL block
    expect(sparql).not.toMatch(/OPTIONAL\s*\{[^}]*title[^}]*\}/i)
    // Only one OPTIONAL (for date)
    const optionalMatches = sparql.match(/OPTIONAL/g) || []
    expect(optionalMatches.length).toBe(1)
  })
})

// ===========================================================================
// Test T14a: buildSparqlQuery with date_to
// ===========================================================================
describe('buildSparqlQuery() – date_to', () => {
  it('T14a – includes FILTER(?date <= ...) when date_to is set', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({
      query: 'carbon border adjustment',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
      date_to: '2024-06-30',
    })

    expect(sparql).toContain('FILTER(?date <= "2024-06-30"^^xsd:date)')
  })

  it('T14b – omits date_to filter when not provided', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({
      query: 'carbon border adjustment',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(sparql).not.toContain('FILTER(?date <=')
  })
})

// ===========================================================================
// Test T14c: fetchDocument non-404 errors
// ===========================================================================
describe('fetchDocument() – non-404 errors', () => {
  it('T14c – throws "Fetch error: 500" on HTTP 500 (after exhausting retries)', async () => {
    // 5xx is retryable: 1 initial attempt + 2 retries = 3 total calls
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.fetchDocument('32021R0694', 'DEU'))
      .rejects.toThrow('Fetch error: 500')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('T14d – throws "Fetch error: 503" on HTTP 503 (after exhausting retries)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.fetchDocument('32021R0694', 'DEU'))
      .rejects.toThrow('Fetch error: 503')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})

// ===========================================================================
// Tests: Old/unavailable document handling (Bug 4)
// ===========================================================================
describe('fetchDocument() – old/unavailable documents', () => {
  it('T14e – throws XHTML-unavailability message on HTTP 406', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 406,
      statusText: 'Not Acceptable',
    })

    const client = new CellarClient()
    await expect(client.fetchDocument('31995L0046', 'DEU'))
      .rejects.toThrow('Document 31995L0046 is not available in XHTML format. Older documents may only exist as PDF on EUR-Lex.')
  })

  it('T14f – 404 error message includes hint about electronic format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    const client = new CellarClient()
    await expect(client.fetchDocument('31995L0046', 'DEU'))
      .rejects.toThrow('The document may not be available in electronic full-text format on EUR-Lex.')
  })
})

// ===========================================================================
// Test V21: SPARQL Injection — escapeSparqlString
// ===========================================================================
describe('escapeSparqlString()', () => {
  it('V21 – escapes quotes and backslashes to prevent SPARQL injection', () => {
    const malicious = 'test " value \\ injection'
    const escaped = escapeSparqlString(malicious)

    // Double quotes must be escaped
    expect(escaped).toContain('\\"')
    // Backslashes must be escaped
    expect(escaped).toContain('\\\\')

    // The escaped value should be safe to embed in a SPARQL string literal
    const sparqlLiteral = `"${escaped}"`
    const unescapedQuotes = sparqlLiteral.match(/(?<!\\)"/g)
    expect(unescapedQuotes).toHaveLength(2) // only the wrapper quotes
  })

  it('escapes newline characters', () => {
    expect(escapeSparqlString('line1\nline2')).toBe('line1\\nline2')
  })

  it('escapes tab characters', () => {
    expect(escapeSparqlString('tab\there')).toBe('tab\\there')
  })

  it('escapes carriage return characters', () => {
    expect(escapeSparqlString('cr\rhere')).toBe('cr\\rhere')
  })

  it('strips null bytes', () => {
    expect(escapeSparqlString('null\0byte')).toBe('nullbyte')
  })
})

// ===========================================================================
// Tests: fetch timeout (AbortSignal)
// ===========================================================================
describe('fetch timeout', () => {
  it('sparqlQuery passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    await client.sparqlQuery('test')
    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeDefined()
  })

  it('fetchDocument passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html></html>',
    })
    const client = new CellarClient()
    await client.fetchDocument('32021R0694', 'DEU')
    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeDefined()
  })

  it('metadataQuery passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{
            title: { type: 'literal', value: 'Test' },
          }],
        },
      }),
    })
    const client = new CellarClient()
    await client.metadataQuery('32021R0694', 'DEU')
    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeDefined()
  })

  it('citationsQuery passes AbortSignal to fetch', async () => {
    // direction 'both' issues two SPARQL POSTs (cites + cited_by) in parallel,
    // so use a persistent mock that answers every call.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    await client.citationsQuery('32021R0694', 'DEU', 'both', 10)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined()
    expect(mockFetch.mock.calls[1][1].signal).toBeDefined()
  })

  it('eurovocQuery passes AbortSignal to fetch (URI path)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    await client.eurovocQuery('http://eurovoc.europa.eu/4424', 'any', 'DEU', 10)
    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeDefined()
  })

  it('eurovocQuery passes AbortSignal to fetch (label path)', async () => {
    // First call: label resolution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [{ concept: { value: 'http://eurovoc.europa.eu/1234' } }] } }),
    })
    // Second call: document query
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    await client.eurovocQuery('environment', 'any', 'DEU', 10)
    // Both calls should have AbortSignal
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined()
    expect(mockFetch.mock.calls[1][1].signal).toBeDefined()
  })

  it('fetchConsolidated passes AbortSignal to both SPARQL and REST fetch calls', async () => {
    // First call: SPARQL to find consolidated CELEX
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: { bindings: [{ celex: { type: 'literal', value: '02021R0694-20210101' } }] },
      }),
    })
    // Second call: Cellar REST to fetch document
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body>Content</body></html>',
    })
    const client = new CellarClient()
    await client.fetchConsolidated('reg', 2021, 694, 'DEU')
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined()
    expect(mockFetch.mock.calls[1][1].signal).toBeDefined()
  })
})

// ===========================================================================
// sparqlQuery with empty bindings
// ===========================================================================
describe('sparqlQuery() – empty bindings', () => {
  it('returns empty results array when bindings are empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('anything')
    expect(results).toEqual([])
  })
})

// ===========================================================================
// Deduplication by CELEX ID
// ===========================================================================
describe('sparqlQuery() – deduplication', () => {
  it('deduplicates results with same CELEX ID but different resource types', async () => {
    const body = makeSparqlResponse([
      { work: 'http://publications.europa.eu/resource/cellar/uuid1', celex: '32024R1689R(01)', title: 'Corrigendum to AI Act', date: '2024-08-01', resType: 'CORRIGENDUM' },
      { work: 'http://publications.europa.eu/resource/cellar/uuid2', celex: '32024R1689R(01)', title: 'Corrigendum to AI Act', date: '2024-08-01', resType: 'REG' },
    ])

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('AI Act')

    // Should deduplicate: same CELEX ID appears only once
    expect(results).toHaveLength(1)
    expect(results[0].celex).toBe('32024R1689R(01)')
    // Keeps the first occurrence (CORRIGENDUM, which comes first by ORDER BY DESC(?date))
    expect(results[0].type).toBe('CORRIGENDUM')
  })
})

// ===========================================================================
// buildSparqlQuery language fallback
// ===========================================================================
describe('buildSparqlQuery() – language fallback', () => {
  it('uses language code directly when not in LANGUAGE_URI_MAP', () => {
    const client = new CellarClient()
    const query = client.buildSparqlQuery({
      query: 'test',
      resource_type: 'any',
      language: 'ITA',
      limit: 10,
    })
    expect(query).toContain('language/ITA')
  })
})
