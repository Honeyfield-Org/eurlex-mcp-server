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

  it('returns null when no concept matches the label (in either the request language or the cross-language fallback)', async () => {
    // Attempt 1 (request language) and attempt 2 (fallback, no LANG filter) both empty.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })

    const client = new CellarClient()
    const uri = await client.resolveEurovocLabel('xyznonexistent123', 'DEU')

    expect(uri).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('escapes special characters in the label (in both the request-language and fallback query)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })

    const client = new CellarClient()
    await client.resolveEurovocLabel('data "protection', 'DEU')

    const firstQuery = mockFetch.mock.calls[0][1].body as string
    const secondQuery = mockFetch.mock.calls[1][1].body as string
    expect(firstQuery).toContain('data \\"protection')
    expect(firstQuery).not.toContain('data "protection')
    expect(secondQuery).toContain('data \\"protection')
    expect(secondQuery).not.toContain('data "protection')
  })
})

// ===========================================================================
// resolveEurovocLabel() cross-language fallback (Task 7b)
//
// Live-smoke finding: concept="data protection" with the DEU default returned
// a silent 0 because the request-language-only query only matches German
// labels. EuroVoc concept URIs are language-independent, so a label match in
// ANY official language resolves the exact same concept — the fallback below
// removes the false "concept doesn't exist" impression for a plain language
// mismatch.
// ===========================================================================
describe('resolveEurovocLabel() cross-language fallback', () => {
  it('falls back to a language-unfiltered query when the request language has no match, and returns that hit', async () => {
    // Attempt 1: request language (DEU / "de"), no match.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
    // Attempt 2: fallback, no LANG filter — finds the English label.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: { bindings: [{ concept: { type: 'uri', value: 'http://eurovoc.europa.eu/4038' } }] },
      }),
    })

    const client = new CellarClient()
    const uri = await client.resolveEurovocLabel('data protection', 'DEU')

    expect(uri).toBe('http://eurovoc.europa.eu/4038')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const firstQuery = mockFetch.mock.calls[0][1].body as string
    const secondQuery = mockFetch.mock.calls[1][1].body as string

    // Attempt 1 is unchanged: filtered to the request language.
    expect(firstQuery).toContain('FILTER(LANG(?label) = "de")')

    // Attempt 2 (fallback) must NOT filter by language at all...
    expect(secondQuery).not.toContain('FILTER(LANG(')
    // ...but must keep the EuroVoc namespace filter, the label match, and the
    // same exact-match-preferred ORDER BY as attempt 1.
    expect(secondQuery).toContain('STRSTARTS(STR(?concept), "http://eurovoc.europa.eu/")')
    expect(secondQuery).toContain('CONTAINS(LCASE(STR(?label)), LCASE("data protection"))')
    expect(secondQuery).toContain('ORDER BY DESC(LCASE(STR(?label)) = LCASE("data protection")) STRLEN(STR(?label))')
  })

  it('does not fall back when the request-language query already finds a match (only 1 fetch call)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: { bindings: [{ concept: { type: 'uri', value: 'http://eurovoc.europa.eu/4038' } }] },
      }),
    })

    const client = new CellarClient()
    const uri = await client.resolveEurovocLabel('Datenschutz', 'DEU')

    expect(uri).toBe('http://eurovoc.europa.eu/4038')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('caches the fallback result under the plain label|language key: a repeat call does not re-fetch', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: { bindings: [{ concept: { type: 'uri', value: 'http://eurovoc.europa.eu/4038' } }] },
      }),
    })

    const client = new CellarClient()
    const first = await client.resolveEurovocLabel('data protection', 'DEU')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const second = await client.resolveEurovocLabel('data protection', 'DEU')

    expect(first).toBe('http://eurovoc.europa.eu/4038')
    expect(second).toBe('http://eurovoc.europa.eu/4038')
    // No 3rd fetch call: the fallback outcome was cached (not just attempt 1's null).
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('propagates an error from the fallback attempt instead of swallowing it (no catch-all)', async () => {
    // Attempt 1 succeeds with a legitimate empty result...
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
    // ...attempt 2 (fallback) fails on every retry.
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.resolveEurovocLabel('something', 'DEU')).rejects.toThrow('fetch failed')
    // 1 (attempt 1) + 1 initial + 2 retries (attempt 2) = 4 calls total.
    expect(mockFetch).toHaveBeenCalledTimes(4)
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

  it('E8 – returns empty array when label resolves to no concept in either the request language or the fallback (non-existent label)', async () => {
    // Label resolution: attempt 1 (request language) and attempt 2 (fallback) both empty.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })

    const client = new CellarClient()
    const results = await client.eurovocQuery('xyznonexistent123', 'any', 'DEU', 10)

    expect(results).toEqual([])
    // Should have made only 2 fetch calls (both label-resolution attempts), no document query
    expect(mockFetch).toHaveBeenCalledTimes(2)
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

// ===========================================================================
// resolveEurovocLabel() caching (Task 6)
// ===========================================================================
describe('resolveEurovocLabel() caching', () => {
  function mockConceptResponse(uri: string) {
    return {
      ok: true,
      json: async () => ({
        results: { bindings: [{ concept: { type: 'uri', value: uri } }] },
      }),
    }
  }

  function mockEmptyResponse() {
    return { ok: true, json: async () => ({ results: { bindings: [] } }) }
  }

  it('CACHE-E1 – caches a successful resolution: two identical calls hit fetch once', async () => {
    mockFetch.mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/4424'))

    const client = new CellarClient()
    const first = await client.resolveEurovocLabel('artificial intelligence', 'ENG')
    const second = await client.resolveEurovocLabel('artificial intelligence', 'ENG')

    expect(first).toBe('http://eurovoc.europa.eu/4424')
    expect(second).toBe('http://eurovoc.europa.eu/4424')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CACHE-E2 – cache key is case-insensitive on the label', async () => {
    mockFetch.mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/4424'))

    const client = new CellarClient()
    await client.resolveEurovocLabel('Artificial Intelligence', 'ENG')
    await client.resolveEurovocLabel('artificial intelligence', 'ENG')
    await client.resolveEurovocLabel('ARTIFICIAL INTELLIGENCE', 'ENG')

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CACHE-E3 – caches a legitimate `null` ("not found") result: second call does not hit fetch', async () => {
    // Both the request-language attempt and the cross-language fallback come up empty.
    mockFetch.mockResolvedValueOnce(mockEmptyResponse()).mockResolvedValueOnce(mockEmptyResponse())

    const client = new CellarClient()
    const first = await client.resolveEurovocLabel('xyznonexistent', 'DEU')
    const second = await client.resolveEurovocLabel('xyznonexistent', 'DEU')

    expect(first).toBeNull()
    expect(second).toBeNull()
    // 2 calls for the first (request-language + fallback) attempt, 0 more for the cached repeat.
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('CACHE-E4 – does NOT cache an error: the second call retries against fetch', async () => {
    // Persistent rejection so all 3 retry attempts (not just the first) fail.
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.resolveEurovocLabel('something', 'DEU')).rejects.toThrow('fetch failed')
    // 1 initial + 2 retries = 3 calls for the first (failed) attempt
    expect(mockFetch).toHaveBeenCalledTimes(3)

    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/9999'))
    const second = await client.resolveEurovocLabel('something', 'DEU')

    expect(second).toBe('http://eurovoc.europa.eu/9999')
    // mockReset() above cleared the call count too — a single successful
    // fetch call here proves the prior error was not served from cache.
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CACHE-E5 – a different language produces a different cache entry', async () => {
    mockFetch
      .mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/4424'))
      .mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/5555'))

    const client = new CellarClient()
    await client.resolveEurovocLabel('protection', 'DEU')
    await client.resolveEurovocLabel('protection', 'ENG')

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('CACHE-E6 – expires after the injected clock advances past the 24h TTL', async () => {
    let now = 0
    mockFetch
      .mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/4424'))
      .mockResolvedValueOnce(mockConceptResponse('http://eurovoc.europa.eu/4424'))

    const client = new CellarClient({ now: () => now })
    await client.resolveEurovocLabel('artificial intelligence', 'ENG')

    now += 24 * 60 * 60 * 1000 // exactly 24h later — TTL boundary, must be expired
    await client.resolveEurovocLabel('artificial intelligence', 'ENG')

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
