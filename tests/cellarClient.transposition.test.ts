import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'
import type { TranspositionQueryParams } from '../src/types.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

function params(overrides: Partial<TranspositionQueryParams> = {}): TranspositionQueryParams {
  return { celex_id: '32022L2555', language: 'DEU', limit: 20, ...overrides }
}

// A NIM row binding for the results query.
function nimRow(celex: string, cc: string, title: string, date: string) {
  return {
    celex: { type: 'literal', value: celex },
    cc: { type: 'literal', value: cc },
    title: { type: 'literal', 'xml:lang': 'xx', value: title },
    date: { type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#date', value: date },
  }
}

// The client fires the results query and the COUNT query in parallel via
// Promise.all. Route each mocked fetch by inspecting the SPARQL body so the
// test is order-independent.
function mockResultsAndCount(rows: unknown[], total: number) {
  mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
    const body = String(options.body)
    if (body.includes('COUNT(')) {
      return {
        ok: true,
        json: async () => ({ results: { bindings: [{ n: { type: 'literal', value: String(total) } }] } }),
      }
    }
    return { ok: true, json: async () => ({ results: { bindings: rows } }) }
  })
}

describe('buildTranspositionQuery()', () => {
  const client = new CellarClient()

  it('T1 – anchors on the directive CELEX via the implements relation', () => {
    const sparql = client.buildTranspositionQuery(params())
    expect(sparql).toContain('cdm:measure_national_implementing_implements_resource_legal ?dir')
    expect(sparql).toContain('FILTER(STR(?dirCelex) = "32022L2555")')
  })

  it('T2 – ties each NIM CELEX to this directive via an anchored regex on the derived sector-7 prefix', () => {
    // NIM prefix = "7" + directive body (celex minus leading sector digit).
    // Anchored (not a bare STRSTARTS prefix) so a superstring body cannot match.
    const sparql = client.buildTranspositionQuery(params({ celex_id: '32022L2555' }))
    expect(sparql).toContain('FILTER(REGEX(STR(?celex), "^72022L2555[A-Z]{3}_"))')
  })

  it('T3 – derives the prefix from the actual directive, not a hardcoded one', () => {
    const sparql = client.buildTranspositionQuery(params({ celex_id: '31995L0046' }))
    expect(sparql).toContain('FILTER(REGEX(STR(?celex), "^71995L0046[A-Z]{3}_"))')
    expect(sparql).toContain('FILTER(STR(?dirCelex) = "31995L0046")')
  })

  it('T2b – anchored regex rejects a superstring directive body (2555 vs 25551)', () => {
    const sparql = client.buildTranspositionQuery(params({ celex_id: '32022L2555' }))
    const celexRegex = extractCelexRegex(sparql)

    // A real NIM of THIS directive: prefix + exactly a 3-letter country code + "_".
    expect(celexRegex.test('72022L2555AUT_202500243')).toBe(true)
    // A NIM of a DIFFERENT directive whose body ("25551") merely starts with the
    // same characters must NOT match — the bug STRSTARTS had.
    expect(celexRegex.test('72022L25551AUT_1')).toBe(false)
  })

  it('T4 – selects country, title (work_title) and date, and reads country tail into ?cc', () => {
    const sparql = client.buildTranspositionQuery(params())
    expect(sparql).toContain('cdm:measure_national_implementing_implemented_by_country ?country')
    expect(sparql).toContain('cdm:work_title ?title')
    expect(sparql).toContain('cdm:work_date_document ?date')
    expect(sparql).toContain('BIND(REPLACE(STR(?country), "^.*/", "") AS ?cc)')
  })

  it('T5 – without a country filter, adds no country FILTER', () => {
    const sparql = client.buildTranspositionQuery(params())
    expect(sparql).not.toContain('FILTER(?country =')
  })

  it('T6 – country=AT maps to the alpha-3 country-authority URI in a FILTER', () => {
    const sparql = client.buildTranspositionQuery(params({ country: 'AT' }))
    expect(sparql).toContain(
      'FILTER(?country = <http://publications.europa.eu/resource/authority/country/AUT>)',
    )
  })

  it('T7 – country=EL (Greece) maps to GRC', () => {
    const sparql = client.buildTranspositionQuery(params({ country: 'EL' }))
    expect(sparql).toContain('authority/country/GRC>')
  })

  it('T8 – ORDER BY DESC(?date) and the LIMIT are applied (anchored, small set)', () => {
    const sparql = client.buildTranspositionQuery(params({ limit: 5 }))
    expect(sparql).toContain('ORDER BY DESC(?date)')
    expect(sparql).toContain('LIMIT 5')
  })

  it('T9 – escapes double-quotes in celex_id (defense-in-depth)', () => {
    const sparql = client.buildTranspositionQuery(params({ celex_id: '3"x' }))
    expect(sparql).toContain('3\\"x')
    // The derived prefix also escapes the injected quote inside the anchored regex.
    expect(sparql).toContain('REGEX(STR(?celex), "^7\\"x[A-Z]{3}_")')
  })
})

/**
 * Pulls the pattern out of the generated `REGEX(STR(?celex), "...")` filter and
 * reverses escapeSparqlString's escaping (inverse of \\ and \"), so tests can
 * exercise the actual regex semantics with a native RegExp instead of asserting
 * on brittle escaped-string literals.
 */
function extractCelexRegex(sparql: string): RegExp {
  const match = sparql.match(/REGEX\(STR\(\?celex\), "((?:\\.|[^"\\])*)"\)\)/)
  if (!match) throw new Error('REGEX(STR(?celex), ...) filter not found in generated SPARQL')
  let pattern = ''
  const escaped = match[1]
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === '\\' && i + 1 < escaped.length) {
      pattern += escaped[i + 1]
      i++
    } else {
      pattern += escaped[i]
    }
  }
  return new RegExp(pattern)
}

describe('transpositionQuery()', () => {
  it('T10 – maps rows to entries: alpha-3→alpha-2 country, eurlex_url, celex', async () => {
    mockResultsAndCount(
      [
        nimRow('72022L2555AUT_202500243', 'AUT', 'NIS-Gesetz', '2025-01-02'),
        nimRow('72022L2555DEU_202500100', 'DEU', 'NIS2-Umsetzungsgesetz', '2024-11-05'),
      ],
      2,
    )
    const client = new CellarClient()
    const result = await client.transpositionQuery(params())

    expect(result.celex_id).toBe('32022L2555')
    expect(result.returned).toBe(2)
    expect(result.total_found).toBe(2)
    expect(result.results[0].country).toBe('AT')
    expect(result.results[0].celex).toBe('72022L2555AUT_202500243')
    expect(result.results[0].eurlex_url).toContain('/de/') // language DEU drives URL locale
    expect(result.results[0].eurlex_url).toContain('CELEX:72022L2555AUT_202500243')
    expect(result.results[1].country).toBe('DE')
  })

  it('T11 – reports total_found from the COUNT query, independent of returned', async () => {
    mockResultsAndCount([nimRow('72022L2555CZE_1', 'CZE', 'x', '2025-01-01')], 285)
    const client = new CellarClient()
    const result = await client.transpositionQuery(params({ limit: 1 }))

    expect(result.returned).toBe(1)
    expect(result.total_found).toBe(285)
    expect(result.total_found).toBeGreaterThan(result.returned)
  })

  it('T12 – falls back to the raw alpha-3 code for non-member states (e.g. GBR)', async () => {
    mockResultsAndCount([nimRow('71995L0046GBR_1', 'GBR', 'UK Data Protection Act', '1998-07-16')], 1)
    const client = new CellarClient()
    const result = await client.transpositionQuery(params({ celex_id: '31995L0046' }))

    expect(result.results[0].country).toBe('GBR')
  })

  it('T13 – missing title/date bindings become empty strings', async () => {
    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = String(options.body)
      if (body.includes('COUNT(')) {
        return { ok: true, json: async () => ({ results: { bindings: [{ n: { value: '1' } }] } }) }
      }
      return {
        ok: true,
        json: async () => ({
          results: {
            bindings: [{ celex: { value: '72022L2555MLT_9' }, cc: { value: 'MLT' } }],
          },
        }),
      }
    })
    const client = new CellarClient()
    const result = await client.transpositionQuery(params())

    expect(result.results[0].title).toBe('')
    expect(result.results[0].date).toBe('')
    expect(result.results[0].country).toBe('MT')
  })

  it('T14 – dedups by CELEX and sorts date-descending', async () => {
    mockResultsAndCount(
      [
        nimRow('72022L2555FIN_1', 'FIN', 'older', '2024-01-01'),
        nimRow('72022L2555PRT_2', 'PRT', 'newer', '2026-06-22'),
        nimRow('72022L2555PRT_2', 'PRT', 'newer', '2026-06-22'), // duplicate row
      ],
      2,
    )
    const client = new CellarClient()
    const result = await client.transpositionQuery(params())

    expect(result.returned).toBe(2)
    expect(result.results[0].celex).toBe('72022L2555PRT_2') // newest first
    expect(result.results[1].celex).toBe('72022L2555FIN_1')
  })

  it('T15 – empty result set yields returned 0 and total_found 0', async () => {
    mockResultsAndCount([], 0)
    const client = new CellarClient()
    const result = await client.transpositionQuery(params({ celex_id: '32016R0679' }))

    expect(result.returned).toBe(0)
    expect(result.total_found).toBe(0)
    expect(result.results).toEqual([])
  })

  it('T16 – sends the country FILTER in the actual request body when filtered', async () => {
    mockResultsAndCount([], 0)
    const client = new CellarClient()
    await client.transpositionQuery(params({ country: 'AT' }))

    const bodies = mockFetch.mock.calls.map((c) => String((c[1] as RequestInit).body))
    expect(bodies.some((b) => b.includes('authority/country/AUT>'))).toBe(true)
  })

  it('T17 – a rejected COUNT query does not fail the call; total_found falls back to the returned entries', async () => {
    const entries = [
      nimRow('72022L2555AUT_1', 'AUT', 'NIS-Gesetz', '2025-01-02'),
      nimRow('72022L2555DEU_2', 'DEU', 'NIS2-Umsetzungsgesetz', '2024-11-05'),
    ]
    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = String(options.body)
      if (body.includes('COUNT(')) {
        throw new Error('SPARQL endpoint error: 500')
      }
      return { ok: true, json: async () => ({ results: { bindings: entries } }) }
    })
    const client = new CellarClient()

    const result = await client.transpositionQuery(params())

    expect(result.returned).toBe(2)
    expect(result.total_found).toBe(result.results.length)
    expect(result.results[0].celex).toBe('72022L2555AUT_1')
  })
})
