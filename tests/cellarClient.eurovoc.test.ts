import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('buildEurovocQuery()', () => {
  it('E4 – only accepts URIs, no longer contains label resolution logic', () => {
    const client = new CellarClient()
    // buildEurovocQuery now only accepts URIs — passing a label should throw
    expect(() => {
      client.buildEurovocQuery('artificial intelligence', 'any', 'ENG', 10)
    }).toThrow()
  })

  it('E5 – uses URI directly when concept starts with http', () => {
    const client = new CellarClient()
    const sparql = client.buildEurovocQuery('http://eurovoc.europa.eu/4424', 'any', 'ENG', 10)

    expect(sparql).toContain('http://eurovoc.europa.eu/4424')
    expect(sparql).not.toContain('skos:prefLabel')
    expect(sparql).not.toContain('CONTAINS')
  })

  it('E6 – applies resource_type filter when not any', () => {
    const client = new CellarClient()
    const sparql = client.buildEurovocQuery('http://eurovoc.europa.eu/4424', 'REG', 'DEU', 10)

    expect(sparql).toContain('resource-type/REG')
  })

  it('E12 – rejects URI with SPARQL injection characters', () => {
    const client = new CellarClient()
    const maliciousUri = 'http://evil.example.org/concept> . ?x ?y ?z . <http://foo'

    expect(() => {
      client.buildEurovocQuery(maliciousUri, 'any', 'ENG', 10)
    }).toThrow()
  })
})

describe('resolveEurovocLabel()', () => {
  it('sends a lightweight SPARQL query to resolve label to URI', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{ concept: { type: 'uri', value: 'http://eurovoc.europa.eu/4424' } }],
        },
      }),
    })

    const client = new CellarClient()
    const uri = await client.resolveEurovocLabel('artificial intelligence', 'ENG')

    expect(uri).toBe('http://eurovoc.europa.eu/4424')

    // Verify the SPARQL query is lightweight (queries skos:Concept, not documents)
    const sparqlSent = mockFetch.mock.calls[0][1].body as string
    expect(sparqlSent).toContain('skos:Concept')
    expect(sparqlSent).toContain('skos:prefLabel')
    expect(sparqlSent).toContain('artificial intelligence')
    expect(sparqlSent).toContain('LIMIT 1')
    // Must filter to EuroVoc namespace for performance
    expect(sparqlSent).toContain('STRSTARTS(STR(?concept), "http://eurovoc.europa.eu/")')
    // Must filter the label to the request language
    expect(sparqlSent).toContain('FILTER(LANG(?label) = "en")')
    // Should NOT contain document-related predicates
    expect(sparqlSent).not.toContain('work_is_about_concept_eurovoc')
  })

  it('propagates a timeout error instead of silently returning null (no catch-all)', async () => {
    // AbortError/TimeoutError is retryable; mock it for every attempt so retries
    // are exhausted (1 initial + 2 retries) and the actionable timeout error surfaces.
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.resolveEurovocLabel('something slow', 'DEU')).rejects.toThrow(
      /SPARQL query timed out/,
    )
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('propagates a network error instead of silently returning null (no catch-all)', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.resolveEurovocLabel('something', 'DEU')).rejects.toThrow('fetch failed')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('propagates a 5xx SPARQL error instead of silently returning null (no catch-all)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.resolveEurovocLabel('something', 'DEU')).rejects.toThrow(
      'SPARQL endpoint error: 500',
    )
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns null when no concept matches the label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    const uri = await client.resolveEurovocLabel('xyznonexistent123', 'DEU')

    expect(uri).toBeNull()
  })

  it('escapes special characters in the label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    await client.resolveEurovocLabel('data "protection', 'DEU')

    const sparqlSent = mockFetch.mock.calls[0][1].body as string
    expect(sparqlSent).toContain('data \\"protection')
    expect(sparqlSent).not.toContain('data "protection')
  })
})

describe('eurovocQuery()', () => {
  it('E7 – label-based query: resolves label first, then queries documents with URI', async () => {
    // First call: resolveEurovocLabel
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{ concept: { type: 'uri', value: 'http://eurovoc.europa.eu/4424' } }],
        },
      }),
    })

    // Second call: document query with resolved URI
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{
            work: { type: 'uri', value: 'http://publications.europa.eu/resource/cellar/uuid1' },
            celex: { type: 'literal', value: '32024R1689' },
            title: { type: 'literal', value: 'AI Act' },
            date: { type: 'literal', value: '2024-06-13' },
            resType: { type: 'literal', value: 'REG' },
          }],
        },
      }),
    })

    const client = new CellarClient()
    const results = await client.eurovocQuery('artificial intelligence', 'any', 'ENG', 10)

    expect(results).toHaveLength(1)
    expect(results[0].celex).toBe('32024R1689')

    // Should have made 2 fetch calls: label resolution + document query
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Second call (document query) should use the resolved URI, not the label
    const docQuery = mockFetch.mock.calls[1][1].body as string
    expect(docQuery).toContain('http://eurovoc.europa.eu/4424')
    expect(docQuery).not.toContain('artificial intelligence')
  })

  it('URI-based query: skips label resolution, queries documents directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{
            work: { type: 'uri', value: 'http://publications.europa.eu/resource/cellar/uuid1' },
            celex: { type: 'literal', value: '32024R1689' },
            title: { type: 'literal', value: 'AI Act' },
            date: { type: 'literal', value: '2024-06-13' },
            resType: { type: 'literal', value: 'REG' },
          }],
        },
      }),
    })

    const client = new CellarClient()
    const results = await client.eurovocQuery('http://eurovoc.europa.eu/4424', 'any', 'ENG', 10)

    expect(results).toHaveLength(1)
    // Should have made only 1 fetch call (no label resolution needed)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('E8 – returns empty array when label resolves to no concept (non-existent label)', async () => {
    // Label resolution returns no results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    const results = await client.eurovocQuery('xyznonexistent123', 'any', 'DEU', 10)

    expect(results).toEqual([])
    // Should have made only 1 fetch call (label resolution), no document query
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('buildEurovocQuery() – URI validation', () => {
  it('throws on URI with angle brackets', () => {
    const client = new CellarClient()
    expect(() => client.buildEurovocQuery('<malicious>', 'any', 'DEU', 10))
      .toThrow(/invalid/i)
  })

  it('throws on URI with spaces', () => {
    const client = new CellarClient()
    expect(() => client.buildEurovocQuery('http://example.com/has space', 'any', 'DEU', 10))
      .toThrow(/invalid/i)
  })
})
