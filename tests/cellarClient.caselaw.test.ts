import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'
import type { CaseLawQueryParams } from '../src/types.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

// Minimal params factory: 'any' court/type, DEU, limit 10 — override per test.
function params(overrides: Partial<CaseLawQueryParams> = {}): CaseLawQueryParams {
  return { court: 'any', type: 'any', language: 'DEU', limit: 10, ...overrides }
}

describe('buildCaseLawQuery()', () => {
  const client = new CellarClient()

  it('CL1 – restricts to the case-law sector (6) via STR filter', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems' }))
    expect(sparql).toContain('cdm:resource_legal_id_sector ?sector')
    expect(sparql).toContain('FILTER(STR(?sector) = "6")')
  })

  it('CL2 – query-only mode: title CONTAINS filter, NO ORDER BY, oversampled LIMIT', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', limit: 10 }))
    expect(sparql).toContain('FILTER(CONTAINS(LCASE(STR(?title)), LCASE("Schrems")))')
    expect(sparql).not.toContain('ORDER BY')
    expect(sparql).toContain('LIMIT 30') // 10 * 3
  })

  it('CL3 – celex_id anchor: exact CELEX filter and ORDER BY (small result set)', () => {
    const sparql = client.buildCaseLawQuery(params({ celex_id: '62012CJ0131' }))
    expect(sparql).toContain('FILTER(STR(?celex) = "62012CJ0131")')
    expect(sparql).toContain('ORDER BY DESC(?date)')
  })

  it('CL4 – ecli anchor: filters case-law_ecli and orders', () => {
    const sparql = client.buildCaseLawQuery(params({ ecli: 'ECLI:EU:C:2014:317' }))
    expect(sparql).toContain('cdm:case-law_ecli ?ecli')
    expect(sparql).toContain('FILTER(STR(?ecli) = "ECLI:EU:C:2014:317")')
    expect(sparql).toContain('ORDER BY DESC(?date)')
  })

  it('CL5 – without an ecli input, ECLI is fetched OPTIONALly for output', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems' }))
    expect(sparql).toContain('OPTIONAL { ?work cdm:case-law_ecli ?ecli . }')
  })

  it('CL6 – related_celex uses the interpretes relation and anchors on the act', () => {
    const sparql = client.buildCaseLawQuery(params({ related_celex: '32016R0679' }))
    expect(sparql).toContain('FILTER(STR(?actCelex) = "32016R0679")')
    expect(sparql).toContain('cdm:case-law_interpretes_resource_legal ?act')
    expect(sparql).toContain('ORDER BY DESC(?date)')
  })

  it('CL7 – type filter binds the resource-type URI and BINDs ?resType', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', type: 'JUDG' }))
    expect(sparql).toContain('resource-type/JUDG')
    expect(sparql).toContain('BIND("JUDG" AS ?resType)')
  })

  it('CL8 – type=any derives ?resType from the URI', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', type: 'any' }))
    expect(sparql).toContain('?work cdm:work_has_resource-type ?resTypeUri')
    expect(sparql).toContain('BIND(REPLACE(STR(?resTypeUri), "^.*/", "") AS ?resType)')
  })

  it('CL9 – court=COURT_JUSTICE maps to corporate-body/CJ', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', court: 'COURT_JUSTICE' }))
    expect(sparql).toContain('corporate-body/CJ>')
    expect(sparql).toContain('cdm:work_created_by_agent')
  })

  it('CL10 – court=GENERAL_COURT maps to corporate-body/GCEU', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', court: 'GENERAL_COURT' }))
    expect(sparql).toContain('corporate-body/GCEU>')
  })

  it('CL11 – court=any adds no work_created_by_agent triple', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', court: 'any' }))
    expect(sparql).not.toContain('work_created_by_agent')
  })

  it('CL12 – date_from / date_to add xsd:date filters', () => {
    const sparql = client.buildCaseLawQuery(
      params({ query: 'Schrems', date_from: '2020-01-01', date_to: '2021-12-31' }),
    )
    expect(sparql).toContain('FILTER(?date >= "2020-01-01"^^xsd:date)')
    expect(sparql).toContain('FILTER(?date <= "2021-12-31"^^xsd:date)')
  })

  it('CL13 – language code is embedded as the language-authority URI suffix', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'Schrems', language: 'POL' }))
    expect(sparql).toContain('authority/language/POL>')
  })

  it('CL14 – combined query + related_celex: both constraints present, anchored ORDER BY', () => {
    const sparql = client.buildCaseLawQuery(
      params({ query: 'Schrems', related_celex: '32016R0679' }),
    )
    expect(sparql).toContain('FILTER(CONTAINS(LCASE(STR(?title)), LCASE("Schrems")))')
    expect(sparql).toContain('cdm:case-law_interpretes_resource_legal ?act')
    expect(sparql).toContain('ORDER BY DESC(?date)')
  })

  it('CL15 – escapes double-quotes in the query term (defense-in-depth)', () => {
    const sparql = client.buildCaseLawQuery(params({ query: 'a"b' }))
    expect(sparql).toContain('a\\"b')
    expect(sparql).not.toMatch(/LCASE\("a"b"\)/)
  })

  it('CL16 – escapes double-quotes in celex_id and ecli anchors', () => {
    const sparql = client.buildCaseLawQuery(
      params({ celex_id: '6"x', ecli: 'ECLI:EU:C:2014:317' }),
    )
    expect(sparql).toContain('6\\"x')
  })

  it('CL22 – lowercase ecli input is normalized to uppercase in the SPARQL FILTER', () => {
    const sparql = client.buildCaseLawQuery(params({ ecli: 'ecli:eu:c:2014:317' }))
    expect(sparql).toContain('FILTER(STR(?ecli) = "ECLI:EU:C:2014:317")')
    expect(sparql).not.toContain('ecli:eu:c:2014:317')
  })

  it('CL23 – mixed-case ecli input is normalized to uppercase in the SPARQL FILTER', () => {
    const sparql = client.buildCaseLawQuery(params({ ecli: 'Ecli:Eu:C:2014:317' }))
    expect(sparql).toContain('FILTER(STR(?ecli) = "ECLI:EU:C:2014:317")')
  })
})

describe('caseLawQuery()', () => {
  it('CL17 – maps bindings to CaseLawEntry with ecli and eurlex_url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              celex: { type: 'literal', value: '62012CJ0131' },
              ecli: { type: 'literal', value: 'ECLI:EU:C:2014:317' },
              title: { type: 'literal', value: 'Google Spain' },
              date: { type: 'literal', value: '2014-05-13' },
              resType: { type: 'literal', value: 'JUDG' },
            },
          ],
        },
      }),
    })

    const client = new CellarClient()
    const result = await client.caseLawQuery({
      ecli: 'ECLI:EU:C:2014:317',
      court: 'any',
      type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.total).toBe(1)
    expect(result.results[0].celex).toBe('62012CJ0131')
    expect(result.results[0].ecli).toBe('ECLI:EU:C:2014:317')
    expect(result.results[0].type).toBe('JUDG')
    expect(result.results[0].eurlex_url).toContain('/de/')
    expect(result.results[0].eurlex_url).toContain('CELEX:62012CJ0131')
  })

  it('CL18 – missing ecli/date bindings become empty strings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              celex: { type: 'literal', value: '62014CN0362' },
              title: { type: 'literal', value: 'Notice' },
              resType: { type: 'literal', value: 'INFO_JUDICIAL' },
            },
          ],
        },
      }),
    })

    const client = new CellarClient()
    const result = await client.caseLawQuery(
      { query: 'Schrems', court: 'any', type: 'any', language: 'ENG', limit: 10 },
    )

    expect(result.results[0].ecli).toBe('')
    expect(result.results[0].date).toBe('')
  })

  it('CL19 – dedups by CELEX (multi-type work) and sorts date-descending', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            // older
            {
              celex: { type: 'literal', value: '62016CJ0498' },
              ecli: { type: 'literal', value: 'ECLI:EU:C:2018:37' },
              title: { type: 'literal', value: 'Schrems v Facebook' },
              date: { type: 'literal', value: '2018-01-25' },
              resType: { type: 'literal', value: 'JUDG' },
            },
            // newer, appears twice (two resource-types on the same work)
            {
              celex: { type: 'literal', value: '62018CJ0311' },
              ecli: { type: 'literal', value: 'ECLI:EU:C:2020:559' },
              title: { type: 'literal', value: 'Schrems II' },
              date: { type: 'literal', value: '2020-07-16' },
              resType: { type: 'literal', value: 'JUDG' },
            },
            {
              celex: { type: 'literal', value: '62018CJ0311' },
              ecli: { type: 'literal', value: 'ECLI:EU:C:2020:559' },
              title: { type: 'literal', value: 'Schrems II' },
              date: { type: 'literal', value: '2020-07-16' },
              resType: { type: 'literal', value: 'CASE_LAW' },
            },
          ],
        },
      }),
    })

    const client = new CellarClient()
    const result = await client.caseLawQuery(
      { query: 'Schrems', court: 'any', type: 'any', language: 'ENG', limit: 10 },
    )

    expect(result.total).toBe(2)
    // newest first
    expect(result.results[0].celex).toBe('62018CJ0311')
    expect(result.results[1].celex).toBe('62016CJ0498')
  })

  it('CL20 – slices to the requested limit after dedup', async () => {
    const bindings = Array.from({ length: 5 }, (_, i) => ({
      celex: { type: 'literal', value: `620${20 + i}CJ000${i}` },
      title: { type: 'literal', value: 'x' },
      date: { type: 'literal', value: `20${20 + i}-01-01` },
      resType: { type: 'literal', value: 'JUDG' },
    }))
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings } }),
    })

    const client = new CellarClient()
    const result = await client.caseLawQuery(
      { query: 'x', court: 'any', type: 'any', language: 'ENG', limit: 2 },
    )
    expect(result.results).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('CL21 – empty bindings yield an empty result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    const result = await client.caseLawQuery(
      { query: 'zzznope', court: 'any', type: 'any', language: 'DEU', limit: 10 },
    )
    expect(result.total).toBe(0)
    expect(result.results).toEqual([])
  })

  it('CL24 – caseLawQuery() sends the uppercase ECLI in the SPARQL request body given lowercase input', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })
    const client = new CellarClient()
    await client.caseLawQuery({
      ecli: 'ecli:eu:c:2014:317',
      court: 'any',
      type: 'any',
      language: 'DEU',
      limit: 10,
    })
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(options.body).toContain('FILTER(STR(?ecli) = "ECLI:EU:C:2014:317")')
    expect(options.body).not.toContain('ecli:eu:c:2014:317')
  })
})
