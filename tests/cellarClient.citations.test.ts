import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient, VALID_RELATIONSHIPS } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('buildCitationsQuery()', () => {
  it('C5 – generates SPARQL for "cites" direction with work_cites_work', () => {
    const client = new CellarClient()
    const sparql = client.buildCitationsQuery('32024R1689', 'DEU', 'cites', 20)

    expect(sparql).toContain('32024R1689')
    expect(sparql).toContain('work_cites_work')
  })

  it('C6 – generates SPARQL for "cited_by" direction', () => {
    const client = new CellarClient()
    const sparql = client.buildCitationsQuery('32024R1689', 'DEU', 'cited_by', 20)

    expect(sparql).toContain('32024R1689')
    expect(sparql).toContain('work_cites_work')
  })

  it('C7 – generates UNION query for "both" direction', () => {
    const client = new CellarClient()
    const sparql = client.buildCitationsQuery('32024R1689', 'DEU', 'both', 20)

    expect(sparql).toContain('UNION')
  })

  it('C8a – query escapes double-quotes in CELEX ID for defense-in-depth', () => {
    const client = new CellarClient()
    const malicious = '32021R"0694'
    const sparql = client.buildCitationsQuery(malicious, 'DEU', 'both', 20)

    expect(sparql).toContain('32021R\\"0694')
    expect(sparql).not.toMatch(/32021R"0694/)
  })

  it('C8 – includes legal basis, amends, and repeals relationships', () => {
    const client = new CellarClient()
    const sparql = client.buildCitationsQuery('32024R1689', 'DEU', 'both', 20)

    expect(sparql).toContain('resource_legal_based_on_resource_legal')
    expect(sparql).toContain('resource_legal_amends_resource_legal')
    expect(sparql).toContain('resource_legal_repeals_resource_legal')
  })
})

describe('citationsQuery()', () => {
  it('C9 – returns CitationsResult with parsed citation entries', async () => {
    // direction 'both' runs two directional queries: cites-side + cited_by-side.
    const citesResponse = {
      results: {
        bindings: [{
          celex: { type: 'literal', value: '32016R0679' },
          title: { type: 'literal', value: 'DSGVO' },
          date: { type: 'literal', value: '2016-04-27' },
          resType: { type: 'literal', value: 'REG' },
          rel: { type: 'literal', value: 'cites' },
        }],
      },
    }
    const citedByResponse = { results: { bindings: [] } }

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => citesResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => citedByResponse })

    const client = new CellarClient()
    const result = await client.citationsQuery('32024R1689', 'DEU', 'both', 20)

    expect(result.celex_id).toBe('32024R1689')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].celex).toBe('32016R0679')
    expect(result.citations[0].relationship).toBe('cites')
    expect(result.counts).toEqual({ cites: 1, cited_by: 0 })
  })

  it('C9a – throws on unexpected relationship value', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [{
            celex: { type: 'literal', value: '32016R0679' },
            title: { type: 'literal', value: 'Test' },
            date: { type: 'literal', value: '2016-04-27' },
            resType: { type: 'literal', value: 'REG' },
            rel: { type: 'literal', value: 'unknown_relationship' },
          }],
        },
      }),
    })
    const client = new CellarClient()
    await expect(client.citationsQuery('32024R1689', 'DEU', 'both', 20))
      .rejects.toThrow(/unexpected relationship/i)
  })

  it('C10 – returns empty citations array when no relationships found', async () => {
    // Both directional queries (cites + cited_by) return nothing.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    })

    const client = new CellarClient()
    const result = await client.citationsQuery('32024R1689', 'DEU', 'both', 20)

    expect(result.citations).toEqual([])
    expect(result.total).toBe(0)
    expect(result.counts).toEqual({ cites: 0, cited_by: 0 })
  })
})

describe('VALID_RELATIONSHIPS', () => {
  it('is a Set with 8 valid relationship types', () => {
    expect(VALID_RELATIONSHIPS).toBeInstanceOf(Set)
    expect(VALID_RELATIONSHIPS.size).toBe(8)
    for (const rel of ['cites', 'cited_by', 'amends', 'amended_by', 'based_on', 'basis_for', 'repeals', 'repealed_by']) {
      expect(VALID_RELATIONSHIPS.has(rel as any)).toBe(true)
    }
  })
})
