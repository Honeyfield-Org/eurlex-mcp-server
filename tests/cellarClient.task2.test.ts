import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

// ---------------------------------------------------------------------------
// Task 2: SPARQL query fixes
//   1. search timeout root cause (no ORDER BY, oversampled LIMIT, client sort)
//   2. L4 filtered-type BIND
//   3. EuroVoc label precision (language + deterministic order)
//   4. citations `both` balance (two directional queries + counts)
//   5. consolidated CELEX anchored-regex matching
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

function sparqlBody(callIndex: number): string {
  return mockFetch.mock.calls[callIndex][1].body as string
}

// ===========================================================================
// 1. Search timeout root cause
// ===========================================================================
describe('buildSparqlQuery() – search timeout fix', () => {
  const baseParams = {
    query: 'data protection',
    resource_type: 'any' as const,
    language: 'DEU',
    limit: 10,
  }

  it('T2-1a – contains no ORDER BY (streaming abort instead of full materialization)', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery(baseParams)
    expect(sparql).not.toContain('ORDER BY')
  })

  it('T2-1b – oversamples LIMIT to min(limit*3, 150)', () => {
    const client = new CellarClient()
    // limit 10 -> 30
    expect(client.buildSparqlQuery({ ...baseParams, limit: 10 })).toContain('LIMIT 30')
    // limit 60 -> capped at 150
    expect(client.buildSparqlQuery({ ...baseParams, limit: 60 })).toContain('LIMIT 150')
    // limit 5 -> 15
    expect(client.buildSparqlQuery({ ...baseParams, limit: 5 })).toContain('LIMIT 15')
  })
})

describe('sparqlQuery() – client-side date sort + slice', () => {
  it('T2-1c – sorts by date desc (empty dates last), dedups, slices to limit', async () => {
    const body = {
      results: {
        bindings: [
          { work: { value: 'w1' }, celex: { value: 'C1' }, title: { value: 'T1' }, date: { value: '2020-01-01' }, resType: { value: 'REG' } },
          // no date -> should end up last, then dropped by slice
          { work: { value: 'w2' }, celex: { value: 'C2' }, title: { value: 'T2' }, resType: { value: 'REG' } },
          { work: { value: 'w3' }, celex: { value: 'C3' }, title: { value: 'T3' }, date: { value: '2023-05-05' }, resType: { value: 'REG' } },
          { work: { value: 'w4' }, celex: { value: 'C4' }, title: { value: 'T4' }, date: { value: '2021-07-07' }, resType: { value: 'REG' } },
        ],
      },
    }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('x', { limit: 3 })

    expect(results.map((r) => r.celex)).toEqual(['C3', 'C4', 'C1'])
  })

  it('T2-1d – dedup keeps the newest occurrence per CELEX after sorting', async () => {
    const body = {
      results: {
        bindings: [
          { work: { value: 'w1' }, celex: { value: 'DUP' }, title: { value: 'Old' }, date: { value: '2019-01-01' }, resType: { value: 'DIR' } },
          { work: { value: 'w2' }, celex: { value: 'DUP' }, title: { value: 'New' }, date: { value: '2024-01-01' }, resType: { value: 'REG' } },
        ],
      },
    }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body })

    const client = new CellarClient()
    const { results } = await client.sparqlQuery('x', { limit: 10 })

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('REG') // the 2024 entry wins after date-desc sort
  })
})

// ===========================================================================
// 2. L4 filtered-type BIND
// ===========================================================================
describe('buildSparqlQuery() – filtered resource type binding', () => {
  const baseParams = {
    query: 'x',
    resource_type: 'REG' as const,
    language: 'DEU',
    limit: 10,
  }

  it('T2-2a – binds the filtered type directly, not via ?resTypeUri', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery(baseParams)

    expect(sparql).toContain('BIND("REG" AS ?resType)')
    // The generic URI-extraction binding must not appear when a type is filtered
    expect(sparql).not.toContain('?resTypeUri')
  })

  it('T2-2b – uses the generic ?resTypeUri binding for resource_type=any', () => {
    const client = new CellarClient()
    const sparql = client.buildSparqlQuery({ ...baseParams, resource_type: 'any' })

    expect(sparql).toContain('?resTypeUri')
    expect(sparql).toContain('BIND(REPLACE(STR(?resTypeUri)')
    expect(sparql).not.toContain('BIND("any" AS ?resType)')
  })
})

// ===========================================================================
// 3. EuroVoc label precision
// ===========================================================================
describe('resolveEurovocLabel() – language + deterministic order', () => {
  it('T2-3a – filters label language to the request language lowercase code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [{ concept: { value: 'http://eurovoc.europa.eu/1' } }] } }),
    })
    const client = new CellarClient()
    await client.resolveEurovocLabel('Datenschutz', 'DEU')

    const body = sparqlBody(0)
    expect(body).toContain('FILTER(LANG(?label) = "de")')
  })

  it('T2-3b – orders exact case-insensitive match first, then shortest label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [{ concept: { value: 'http://eurovoc.europa.eu/1' } }] } }),
    })
    const client = new CellarClient()
    await client.resolveEurovocLabel('data protection', 'ENG')

    const body = sparqlBody(0)
    expect(body).toContain('ORDER BY DESC(LCASE(STR(?label)) = LCASE("data protection")) STRLEN(STR(?label))')
    expect(body).toContain('LIMIT 1')
    // Still namespace-scoped for performance
    expect(body).toContain('STRSTARTS(STR(?concept), "http://eurovoc.europa.eu/")')
  })
})

// ===========================================================================
// 4. Citations `both` balance
// ===========================================================================
describe('citationsQuery() – both-direction split', () => {
  function citesResponse() {
    return {
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            { celex: { value: '32016R0679' }, title: { value: 'GDPR' }, date: { value: '2016-04-27' }, resType: { value: 'REG' }, rel: { value: 'cites' } },
            { celex: { value: '31995L0046' }, title: { value: 'DPD' }, date: { value: '1995-10-24' }, resType: { value: 'DIR' }, rel: { value: 'based_on' } },
          ],
        },
      }),
    }
  }
  function citedByResponse() {
    return {
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            { celex: { value: '32023R1234' }, title: { value: 'Later' }, date: { value: '2023-01-01' }, resType: { value: 'REG' }, rel: { value: 'cited_by' } },
          ],
        },
      }),
    }
  }

  it('T2-4a – issues two SPARQL calls with split limits (10/10 for limit 20), cites first', async () => {
    mockFetch.mockResolvedValueOnce(citesResponse()).mockResolvedValueOnce(citedByResponse())

    const client = new CellarClient()
    const result = await client.citationsQuery('32024R1689', 'DEU', 'both', 20)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    // cites-side query first, cited_by-side second
    expect(sparqlBody(0)).toContain('BIND("cites" AS ?rel)')
    expect(sparqlBody(0)).toContain('LIMIT 10')
    expect(sparqlBody(1)).toContain('BIND("cited_by" AS ?rel)')
    expect(sparqlBody(1)).toContain('LIMIT 10')

    // merged: cites-side entries first, then cited_by-side
    expect(result.citations.map((c) => c.celex)).toEqual(['32016R0679', '31995L0046', '32023R1234'])
    expect(result.total).toBe(3)
    expect(result.counts).toEqual({ cites: 2, cited_by: 1 })
  })

  it('T2-4b – splits an odd limit as ceil/floor', async () => {
    mockFetch.mockResolvedValueOnce(citesResponse()).mockResolvedValueOnce(citedByResponse())

    const client = new CellarClient()
    await client.citationsQuery('32024R1689', 'DEU', 'both', 21)

    expect(sparqlBody(0)).toContain('LIMIT 11') // ceil(21/2)
    expect(sparqlBody(1)).toContain('LIMIT 10') // floor(21/2)
  })

  it('T2-4c – single-direction cites: one call, counts.cited_by = 0', async () => {
    mockFetch.mockResolvedValueOnce(citesResponse())

    const client = new CellarClient()
    const result = await client.citationsQuery('32024R1689', 'DEU', 'cites', 20)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.counts).toEqual({ cites: 2, cited_by: 0 })
  })

  it('T2-4d – single-direction cited_by: one call, counts.cites = 0', async () => {
    mockFetch.mockResolvedValueOnce(citedByResponse())

    const client = new CellarClient()
    const result = await client.citationsQuery('32024R1689', 'DEU', 'cited_by', 20)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.counts).toEqual({ cites: 0, cited_by: 1 })
  })
})

// ===========================================================================
// 5. Consolidated CELEX anchored-regex matching
// ===========================================================================
describe('findConsolidatedCelex() – anchored regex', () => {
  it('T2-5a – uses an anchored REGEX, not a bare STRSTARTS prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [{ celex: { value: '02024R1689-20240712' } }] } }),
    })

    const client = new CellarClient()
    await client.findConsolidatedCelex('reg', 2024, 1689)

    const body = sparqlBody(0)
    expect(body).toContain('REGEX(STR(?celex), "^02024R1689(-[0-9]{8})?$")')
    expect(body).not.toContain('STRSTARTS')
    // invariant preserved: newest consolidation is lexicographically largest
    expect(body).toContain('ORDER BY DESC(?celex)')
    expect(body).toContain('LIMIT 1')
  })

  it('T2-5b – zero-pads the number to 4 digits in the regex', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    await client.findConsolidatedCelex('reg', 2016, 679)

    expect(sparqlBody(0)).toContain('REGEX(STR(?celex), "^02016R0679(-[0-9]{8})?$")')
  })
})
