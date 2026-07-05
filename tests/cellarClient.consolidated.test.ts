import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

/** Helper: mock a SPARQL response returning a consolidated CELEX ID */
function mockSparqlCelexResponse(celex: string) {
  return {
    ok: true,
    json: async () => ({
      results: {
        bindings: [{ celex: { type: 'literal', value: celex } }],
      },
    }),
  }
}

/** Helper: mock a SPARQL response with no results */
function mockSparqlEmptyResponse() {
  return {
    ok: true,
    json: async () => ({ results: { bindings: [] } }),
  }
}

/** Helper: mock a Cellar REST document response */
function mockDocumentResponse(content: string) {
  return {
    ok: true,
    text: async () => content,
  }
}

describe('fetchConsolidated()', () => {
  it('CO4 – step 1: queries SPARQL for consolidated CELEX ID', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Consolidated text</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('reg', 2024, 1689, 'DEU')

    // First call should be SPARQL to find consolidated CELEX
    const [url1, opts1] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url1).toContain('sparql')
    expect(opts1.body).toContain('02024R1689')
  })

  it('CO4b – step 2: fetches document from Cellar REST using resolved CELEX', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Consolidated text</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('reg', 2024, 1689, 'DEU')

    // Second call should be Cellar REST with the consolidated CELEX
    const [url2, opts2] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(url2).toContain('publications.europa.eu/resource/celex/02024R1689-20240712')
    expect((opts2.headers as Record<string, string>).Accept).toBe('application/xhtml+xml, text/html')
    expect((opts2.headers as Record<string, string>)['Accept-Language']).toBe('de')
  })

  it('CO5 – returns content, eliUrl and consolidatedCelex', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02022L2555-20230101'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Artikel 1</body></html>'))

    const client = new CellarClient()
    const result = await client.fetchConsolidated('dir', 2022, 2555, 'DEU')

    expect(result.content).toContain('Artikel 1')
    expect(result.eliUrl).toContain('data.europa.eu/eli/dir/2022/2555')
    expect(result.consolidatedCelex).toBe('02022L2555-20230101')
  })

  it('CO6 – throws when no consolidated CELEX found via SPARQL', async () => {
    mockFetch.mockResolvedValueOnce(mockSparqlEmptyResponse())

    const client = new CellarClient()
    await expect(client.fetchConsolidated('reg', 9999, 9999, 'DEU'))
      .rejects.toThrow(/eurlex_fetch/)
  })

  it('CO6-EN – "no consolidated CELEX" error message is in English', async () => {
    mockFetch.mockResolvedValueOnce(mockSparqlEmptyResponse())

    const client = new CellarClient()
    await expect(client.fetchConsolidated('reg', 9999, 9999, 'DEU')).rejects.toThrow(
      'No consolidated version available for reg/9999/9999. Use eurlex_fetch with the CELEX ID for the original OJ version.',
    )
  })

  it('CO-404-EN – "consolidated document not retrievable" error message is in English', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce({ ok: false, status: 404 })

    const client = new CellarClient()
    let caught: unknown
    try {
      await client.fetchConsolidated('reg', 2024, 1689, 'DEU')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toBe(
      'No consolidated version available for reg/2024/1689 (02024R1689-20240712 could not be retrieved). Use eurlex_fetch with the CELEX ID for the original OJ version.',
    )
    // No German words should remain
    expect(message).not.toMatch(/Keine|verfügbar|Verwenden|konsolidierte|Fassung/)
  })

  it('CO6b – maps doc_type to CELEX prefix correctly (R=reg, L=dir, D=dec)', async () => {
    // Test directive
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02019L1024-20240101'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Directive content</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('dir', 2019, 1024, 'DEU')

    const sparqlBody = (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    expect(sparqlBody).toContain('02019L1024')
  })

  it('CO-ENG – uses correct Accept-Language for ENG', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02016R0679-20180525'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>English content</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('reg', 2016, 679, 'ENG')

    const [, opts2] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect((opts2.headers as Record<string, string>)['Accept-Language']).toBe('en')
  })

  it('CO-FRA – uses correct Accept-Language for FRA', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02016R0679-20180525'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Contenu français</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('reg', 2016, 679, 'FRA')

    const [, opts2] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect((opts2.headers as Record<string, string>)['Accept-Language']).toBe('fr')
  })

  it('CO-404 – throws with eurlex_fetch hint when Cellar REST returns 404', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce({ ok: false, status: 404 })

    const client = new CellarClient()
    await expect(client.fetchConsolidated('reg', 2024, 1689, 'DEU'))
      .rejects.toThrow(/eurlex_fetch/)
  })

  it('CO-500 – handles non-404 HTTP errors from Cellar REST (after exhausting retries)', async () => {
    // 5xx on the REST step is retryable: 1 initial attempt + 2 retries = 3 total REST calls
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02016R0679-20180525'))
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.fetchConsolidated('reg', 2016, 679, 'ENG'))
      .rejects.toThrow(/500/)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('CO-DEC – maps dec doc_type to D in CELEX prefix', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02021D0914-20230101'))
      .mockResolvedValueOnce(mockDocumentResponse('<html><body>Decision content</body></html>'))

    const client = new CellarClient()
    await client.fetchConsolidated('dec', 2021, 914, 'DEU')

    const sparqlBody = (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    expect(sparqlBody).toContain('02021D0914')
  })
})

// ===========================================================================
// findConsolidatedCelex() caching (Task 6)
// ===========================================================================
describe('findConsolidatedCelex() caching', () => {
  it('CACHE-C1 – caches a successful lookup: two identical calls hit fetch once', async () => {
    mockFetch.mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))

    const client = new CellarClient()
    const first = await client.findConsolidatedCelex('reg', 2024, 1689)
    const second = await client.findConsolidatedCelex('reg', 2024, 1689)

    expect(first).toBe('02024R1689-20240712')
    expect(second).toBe('02024R1689-20240712')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CACHE-C2 – caches a legitimate `null` ("not found") result: second call does not hit fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockSparqlEmptyResponse())

    const client = new CellarClient()
    const first = await client.findConsolidatedCelex('reg', 9999, 9999)
    const second = await client.findConsolidatedCelex('reg', 9999, 9999)

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CACHE-C3 – does NOT cache an error: the second call retries against fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const client = new CellarClient({ retryDelayFn: async () => {} })
    await expect(client.findConsolidatedCelex('reg', 2024, 1689)).rejects.toThrow(
      'SPARQL endpoint error: 500',
    )
    expect(mockFetch).toHaveBeenCalledTimes(3)

    mockFetch.mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
    const second = await client.findConsolidatedCelex('reg', 2024, 1689)

    expect(second).toBe('02024R1689-20240712')
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('CACHE-C4 – a different docType/year/number produces a different cache entry', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce(mockSparqlCelexResponse('02016R0679-20160504'))

    const client = new CellarClient()
    await client.findConsolidatedCelex('reg', 2024, 1689)
    await client.findConsolidatedCelex('reg', 2016, 679)

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('CACHE-C5 – expires after the injected clock advances past the 6h TTL', async () => {
    let now = 0
    mockFetch
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))
      .mockResolvedValueOnce(mockSparqlCelexResponse('02024R1689-20240712'))

    const client = new CellarClient({ now: () => now })
    await client.findConsolidatedCelex('reg', 2024, 1689)

    now += 6 * 60 * 60 * 1000 // exactly 6h later — TTL boundary, must be expired
    await client.findConsolidatedCelex('reg', 2024, 1689)

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
