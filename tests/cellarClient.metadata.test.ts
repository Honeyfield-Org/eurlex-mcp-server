import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient, escapeSparqlString } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

describe('CellarClient – Metadata', () => {
  const client = new CellarClient()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  // =========================================================================
  // buildMetadataQuery()
  // =========================================================================
  describe('buildMetadataQuery()', () => {
    it('M4 – query contains CELEX filter (resource_legal_id_celex with FILTER)', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')
      expect(sparql).toContain('resource_legal_id_celex')
      expect(sparql).toContain('32021R0694')
      expect(sparql).toContain('FILTER(STR(?celexVal)')
    })

    it('M5 – query contains all CDM properties', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      expect(sparql).toContain('work_date_document')
      expect(sparql).toContain('resource_legal_date_entry-into-force')
      expect(sparql).toContain('resource_legal_date_end-of-validity')
      expect(sparql).toContain('resource_legal_in-force')
      expect(sparql).toContain('work_created_by_agent')
      expect(sparql).toContain('work_is_about_concept_eurovoc')
      expect(sparql).toContain('resource_legal_is_about_concept_directory-code')
    })

    it('M5b – query uses correct language URI for expression title', () => {
      const sparqlDeu = client.buildMetadataQuery('32021R0694', 'DEU')
      expect(sparqlDeu).toContain('language/DEU')

      const sparqlEng = client.buildMetadataQuery('32021R0694', 'ENG')
      expect(sparqlEng).toContain('language/ENG')
    })

    it('M5c – query uses GROUP_CONCAT for multi-value fields', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      // Should have GROUP_CONCAT with ||| separator for authors, eurovoc, dirCodes
      const groupConcatMatches = sparql.match(/GROUP_CONCAT/g) || []
      expect(groupConcatMatches.length).toBeGreaterThanOrEqual(3)
      expect(sparql).toContain('|||')
    })

    it('M5e – query escapes double-quotes in CELEX ID via escapeSparqlString', () => {
      const malicious = '32021R"0694'
      const sparql = client.buildMetadataQuery(malicious, 'DEU')

      // The escaped form should appear in the SPARQL FILTER
      expect(sparql).toContain('32021R\\"0694')
      // The raw unescaped double-quote must NOT appear bare in the query
      expect(sparql).not.toMatch(/32021R"0694/)
    })

    it('M5d – query includes skos:prefLabel for EuroVoc labels', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      expect(sparql).toContain('skos:prefLabel')
      expect(sparql).toContain('PREFIX skos:')
    })
  })

  // =========================================================================
  // metadataQuery()
  // =========================================================================
  describe('metadataQuery()', () => {
    function makeMetadataSparqlResponse(binding: Record<string, { type: string; value: string }>) {
      return {
        results: {
          bindings: [binding],
        },
      }
    }

    const fullBinding = {
      title: { type: 'literal', value: 'Regulation on carbon border adjustment' },
      dateDoc: { type: 'literal', value: '2021-05-01' },
      dateForce: { type: 'literal', value: '2021-10-01' },
      dateEnd: { type: 'literal', value: '2030-12-31' },
      inForce: { type: 'literal', value: 'true' },
      dateTrans: { type: 'literal', value: '2023-01-01' },
      resType: { type: 'literal', value: 'REG' },
      authors: { type: 'literal', value: 'European Commission|||Council of the European Union' },
      eurovoc: { type: 'literal', value: 'climate change|||carbon tax' },
      dirCodes: { type: 'literal', value: '11.60.30|||15.10.20' },
    }

    it('M6 – returns MetadataResult with all fields populated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(fullBinding),
      })

      const result = await client.metadataQuery('32021R0694', 'DEU')

      expect(result).toMatchObject({
        celex_id: '32021R0694',
        title: 'Regulation on carbon border adjustment',
        date_document: '2021-05-01',
        date_entry_into_force: '2021-10-01',
        date_end_of_validity: '2030-12-31',
        in_force: true,
        date_transposition: '2023-01-01',
        resource_type: 'REG',
        authors: ['European Commission', 'Council of the European Union'],
        eurovoc_concepts: ['climate change', 'carbon tax'],
        directory_codes: ['11.60.30', '15.10.20'],
      })
      expect(result.eurlex_url).toContain('CELEX:32021R0694')
      expect(result.eurlex_url).toContain('/de/')
    })

    it('M7 – returns empty strings/arrays for missing optional fields', async () => {
      const minimalBinding = {
        title: { type: 'literal', value: 'Minimal document' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(minimalBinding),
      })

      const result = await client.metadataQuery('32021R0694', 'DEU')

      expect(result.title).toBe('Minimal document')
      expect(result.date_document).toBe('')
      expect(result.date_entry_into_force).toBe('')
      expect(result.date_end_of_validity).toBe('')
      expect(result.in_force).toBeNull()
      expect(result.date_transposition).toBe('')
      expect(result.resource_type).toBe('')
      expect(result.authors).toEqual([])
      expect(result.eurovoc_concepts).toEqual([])
      expect(result.directory_codes).toEqual([])
    })

    it('M7b – throws when no bindings returned (CELEX not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: { bindings: [] } }),
      })

      await expect(client.metadataQuery('39999X0000', 'DEU')).rejects.toThrow(
        'No metadata found for CELEX: 39999X0000'
      )
    })

    it('M8 – throws on SPARQL endpoint error (HTTP 500, after exhausting retries)', async () => {
      // 5xx is retryable: 1 initial attempt + 2 retries = 3 total calls
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })

      const retryClient = new CellarClient({ retryDelayFn: async () => {} })
      await expect(retryClient.metadataQuery('32021R0694', 'DEU')).rejects.toThrow(
        'SPARQL endpoint error: 500'
      )
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('M8b – correctly parses in_force as boolean', async () => {
      // true case
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            inForce: { type: 'literal', value: 'true' },
          }),
      })
      const resultTrue = await client.metadataQuery('32021R0694', 'DEU')
      expect(resultTrue.in_force).toBe(true)

      // false case
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            inForce: { type: 'literal', value: 'false' },
          }),
      })
      const resultFalse = await client.metadataQuery('32021R0694', 'DEU')
      expect(resultFalse.in_force).toBe(false)

      // "1" case (xsd:boolean alternate)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            inForce: { type: 'literal', value: '1' },
          }),
      })
      const result1 = await client.metadataQuery('32021R0694', 'DEU')
      expect(result1.in_force).toBe(true)

      // "0" case (xsd:boolean alternate)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            inForce: { type: 'literal', value: '0' },
          }),
      })
      const result0 = await client.metadataQuery('32021R0694', 'DEU')
      expect(result0.in_force).toBe(false)

      // missing case
      const { inForce: _removed, ...bindingNoForce } = fullBinding
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(bindingNoForce),
      })
      const resultNull = await client.metadataQuery('32021R0694', 'DEU')
      expect(resultNull.in_force).toBeNull()
    })

    it('M8c – correctly splits GROUP_CONCAT values into arrays', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            authors: { type: 'literal', value: 'Author A|||Author B|||Author C' },
            eurovoc: { type: 'literal', value: 'concept1' },
            dirCodes: { type: 'literal', value: '' },
          }),
      })

      const result = await client.metadataQuery('32021R0694', 'DEU')

      expect(result.authors).toEqual(['Author A', 'Author B', 'Author C'])
      expect(result.eurovoc_concepts).toEqual(['concept1'])
      expect(result.directory_codes).toEqual([])
    })
  })
})
