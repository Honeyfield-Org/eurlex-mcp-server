import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

// ---------------------------------------------------------------------------
// Task 2: ELI / OJ-reference -> CELEX resolution (SPARQL, fetch mocked)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

function jsonResponse(bindings: { celex: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: { bindings: bindings.map((b) => ({ celex: { value: b.celex } })) },
    }),
  }
}

function sparqlBody(callIndex = 0): string {
  return mockFetch.mock.calls[callIndex][1].body as string
}

// ===========================================================================
// resolveEliToCelex
// ===========================================================================
describe('resolveEliToCelex()', () => {
  it('R-ELI1 – builds a cdm:resource_legal_eli literal filter with the canonical URI', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ celex: '32016R0679' }]))
    const client = new CellarClient()

    const celex = await client.resolveEliToCelex('reg/2016/679')

    expect(celex).toBe('32016R0679')
    const body = sparqlBody()
    expect(body).toContain('cdm:resource_legal_eli ?eli')
    expect(body).toContain(
      'FILTER(STR(?eli) = "http://data.europa.eu/eli/reg/2016/679/oj")'
    )
    expect(body).toContain('cdm:resource_legal_id_celex ?celex')
  })

  it('R-ELI2 – accepts the full ELI URL form', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ celex: '32024R1689' }]))
    const client = new CellarClient()

    const celex = await client.resolveEliToCelex('http://data.europa.eu/eli/reg/2024/1689/oj')

    expect(celex).toBe('32024R1689')
  })

  it('R-ELI3 – throws a clear, example-bearing error when nothing resolves', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))
    const client = new CellarClient()

    await expect(client.resolveEliToCelex('reg/1800/999')).rejects.toThrow(
      /Could not resolve ELI .* no matching EU act found/
    )
  })

  it('R-ELI4 – malformed ELI is rejected before any network call', async () => {
    const client = new CellarClient()

    await expect(client.resolveEliToCelex('nonsense')).rejects.toThrow(/Invalid ELI/)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// resolveOjRefToCelex
// ===========================================================================
describe('resolveOjRefToCelex()', () => {
  it('R-OJ1 – builds an owl:sameAs lookup against the OJ resource URI', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ celex: '32024R1689' }]))
    const client = new CellarClient()

    const celex = await client.resolveOjRefToCelex('OJ:L_202401689')

    expect(celex).toBe('32024R1689')
    const body = sparqlBody()
    expect(body).toContain(
      'owl:sameAs <http://publications.europa.eu/resource/oj/L_202401689>'
    )
    expect(body).toContain('cdm:resource_legal_id_celex ?celex')
  })

  it('R-OJ2 – throws a clear, example-bearing error when nothing resolves', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))
    const client = new CellarClient()

    await expect(client.resolveOjRefToCelex('OJ:L_999999999')).rejects.toThrow(
      /Could not resolve OJ reference .* no matching EU act found/
    )
  })

  it('R-OJ3 – malformed OJ reference is rejected before any network call', async () => {
    const client = new CellarClient()

    await expect(client.resolveOjRefToCelex('L_202401689')).rejects.toThrow(
      /Invalid OJ reference/
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// resolveCelexId dispatch
// ===========================================================================
describe('resolveCelexId()', () => {
  it('R-D1 – returns a celex_id verbatim with no network call', async () => {
    const client = new CellarClient()

    const celex = await client.resolveCelexId({ celex_id: '32024R1689' })

    expect(celex).toBe('32024R1689')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('R-D2 – dispatches to the ELI resolver', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ celex: '32016R0679' }]))
    const client = new CellarClient()

    const celex = await client.resolveCelexId({ eli: 'reg/2016/679' })

    expect(celex).toBe('32016R0679')
    expect(sparqlBody()).toContain('cdm:resource_legal_eli')
  })

  it('R-D3 – dispatches to the OJ-reference resolver', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ celex: '32024R1689' }]))
    const client = new CellarClient()

    const celex = await client.resolveCelexId({ oj_ref: 'OJ:L_202401689' })

    expect(celex).toBe('32024R1689')
    expect(sparqlBody()).toContain('owl:sameAs')
  })

  it('R-D4 – throws when no identifier is present (defensive guard)', async () => {
    const client = new CellarClient()

    await expect(client.resolveCelexId({})).rejects.toThrow(/No identifier provided/)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
