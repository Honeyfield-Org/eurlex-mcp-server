import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('language URI construction (non-DE/EN/FR)', () => {
  const client = new CellarClient()

  it('CL-LANG-1 – buildSparqlQuery embeds the Polish language-authority URI', () => {
    const sparql = client.buildSparqlQuery({
      query: 'sztuczna inteligencja',
      resource_type: 'any',
      language: 'POL',
      limit: 10,
    })
    expect(sparql).toContain(
      'cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/POL>',
    )
  })

  it('CL-LANG-2 – buildMetadataQuery uses the Spanish URI and "es" LANG() filters', () => {
    const sparql = client.buildMetadataQuery('32024R1689', 'SPA')
    expect(sparql).toContain('authority/language/SPA')
    // The ISO-2 tag drives the SPARQL LANG() filters for EuroVoc/agent/dir labels.
    expect(sparql).toContain('FILTER(LANG(?evLabel) = "es")')
    expect(sparql).toContain('FILTER(LANG(?agentLabelLang) = "es")')
  })

  it('CL-LANG-3 – buildEurovocQuery embeds the Polish language-authority URI', () => {
    const sparql = client.buildEurovocQuery(
      'http://eurovoc.europa.eu/3030',
      'any',
      'POL',
      10,
    )
    expect(sparql).toContain('authority/language/POL')
  })
})

describe('sparqlQuery with a non-DE/EN/FR language (mocked)', () => {
  it('CL-LANG-4 – sends the POL URI and builds a /pl/ eur-lex URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              work: { type: 'uri', value: 'http://publications.europa.eu/resource/cellar/x' },
              celex: { type: 'literal', value: '32024R1689' },
              title: { type: 'literal', value: 'Rozporządzenie ... sztucznej inteligencji' },
              date: { type: 'literal', value: '2024-06-13' },
              resType: { type: 'literal', value: 'REG' },
            },
          ],
        },
      }),
    })

    const client = new CellarClient()
    const { results, sparql } = await client.sparqlQuery('sztuczna inteligencja', {
      language: 'POL',
      limit: 10,
    })

    // The query that was actually sent must carry the Polish language URI.
    const sentBody = mockFetch.mock.calls[0][1].body as string
    expect(sentBody).toContain('authority/language/POL')
    expect(sparql).toContain('authority/language/POL')

    // The result URL must use the ISO-2 tag "pl", not the "de" default.
    expect(results).toHaveLength(1)
    expect(results[0].eurlex_url).toContain('/pl/TXT/')
    expect(results[0].celex).toBe('32024R1689')
  })
})
