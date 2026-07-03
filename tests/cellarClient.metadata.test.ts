import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'

const mockFetch = vi.fn()

describe('CellarClient – Metadata', () => {
  // Recreated in beforeEach (not a single shared const): metadataQuery() now
  // caches by celexId|language (Task 6), and several tests below reuse the
  // same CELEX/language with different mocked responses — a long-lived
  // client would serve a stale cached result instead of exercising the fetch
  // mock. A fresh client per test keeps each test's cache empty.
  let client = new CellarClient()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    client = new CellarClient()
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

    it('M5c – query uses GROUP_CONCAT for all four multi-value fields', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      // authors, eurovoc, dirCodes, legalBases
      const groupConcatMatches = sparql.match(/GROUP_CONCAT/g) || []
      expect(groupConcatMatches.length).toBeGreaterThanOrEqual(4)
      expect(sparql).toContain('|||')
      expect(sparql).toContain('AS ?authors')
      expect(sparql).toContain('AS ?eurovoc')
      expect(sparql).toContain('AS ?dirCodes')
      expect(sparql).toContain('AS ?legalBases')
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

    it('M5f – authors use agent skos:prefLabel, NOT the broken cdm:agent_name', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      // The old (bug) property must be gone entirely
      expect(sparql).not.toContain('agent_name')
      // Author label = language prefLabel, fallback English, last resort URI tail.
      expect(sparql).toContain('work_created_by_agent')
      expect(sparql).toContain('COALESCE')
    })

    it('M5g – authors label fallback filters by request language then English', () => {
      const sparqlDeu = client.buildMetadataQuery('32021R0694', 'DEU')
      // request-language prefLabel filter (de) plus English fallback filter (en)
      expect(sparqlDeu).toContain('"de"')
      expect(sparqlDeu).toContain('"en"')

      const sparqlFra = client.buildMetadataQuery('32021R0694', 'FRA')
      expect(sparqlFra).toContain('"fr"')
      expect(sparqlFra).toContain('"en"')
    })

    it('M5h – query includes legal basis via resource_legal_based_on_resource_legal', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      expect(sparql).toContain('resource_legal_based_on_resource_legal')
      // basis CELEX is collected via resource_legal_id_celex on the basis resource
      expect(sparql).toContain('?basisCelex')
      expect(sparql).toContain('AS ?legalBases')
    })

    it('M5i – directory codes combine code tail with skos:prefLabel', () => {
      const sparql = client.buildMetadataQuery('32021R0694', 'DEU')

      // code tail via REPLACE on the dir-code URI, label combined via CONCAT,
      // conditional on the label being bound.
      expect(sparql).toContain('resource_legal_is_about_concept_directory-code')
      expect(sparql).toContain('CONCAT')
      expect(sparql).toContain('BOUND(?dirLabel)')
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

    // Shaped like the verified live probe result for CELEX 32016R0679 (GDPR),
    // except date_end_of_validity carries a real (non-sentinel) date here so the
    // "all fields populated" case is distinct from the dedicated sentinel case.
    const fullBinding = {
      title: {
        type: 'literal',
        value: 'Verordnung (EU) 2016/679 des Europäischen Parlaments und des Rates',
      },
      dateDoc: { type: 'literal', value: '2016-04-27' },
      dateForce: { type: 'literal', value: '2016-05-24' },
      dateEnd: { type: 'literal', value: '2030-12-31' },
      inForce: { type: 'literal', value: '1' },
      dateTrans: { type: 'literal', value: '2023-01-01' },
      resType: { type: 'literal', value: 'REG' },
      authors: {
        type: 'literal',
        value: 'Europäisches Parlament|||Rat der Europäischen Union',
      },
      eurovoc: { type: 'literal', value: 'Datenschutz|||persönliche Daten' },
      dirCodes: {
        type: 'literal',
        value: '152020: Unterrichtung, Aufklärung und Vertretung der Verbraucher|||1940: Aktionsprogramme',
      },
      legalBases: { type: 'literal', value: '12012E016' },
    }

    it('M6 – returns MetadataResult with all fields populated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(fullBinding),
      })

      const result = await client.metadataQuery('32016R0679', 'DEU')

      expect(result).toMatchObject({
        celex_id: '32016R0679',
        date_document: '2016-04-27',
        date_entry_into_force: '2016-05-24',
        date_end_of_validity: '2030-12-31',
        in_force: true,
        date_transposition: '2023-01-01',
        resource_type: 'REG',
        authors: ['Europäisches Parlament', 'Rat der Europäischen Union'],
        eurovoc_concepts: ['Datenschutz', 'persönliche Daten'],
        directory_codes: [
          '152020: Unterrichtung, Aufklärung und Vertretung der Verbraucher',
          '1940: Aktionsprogramme',
        ],
        legal_basis: ['12012E016'],
      })
      expect(result.eurlex_url).toContain('CELEX:32016R0679')
      expect(result.eurlex_url).toContain('/de/')
    })

    it('M6b – normalizes the 9999-12-31 end-of-validity sentinel to null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            dateEnd: { type: 'literal', value: '9999-12-31' },
          }),
      })

      const result = await client.metadataQuery('32016R0679', 'DEU')
      expect(result.date_end_of_validity).toBeNull()
      // other dates unaffected
      expect(result.date_document).toBe('2016-04-27')
      expect(result.date_entry_into_force).toBe('2016-05-24')
    })

    it('M6c – parses multiple legal bases into an array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            legalBases: { type: 'literal', value: '12012E016|||12012E114' },
          }),
      })

      const result = await client.metadataQuery('32016R0679', 'DEU')
      expect(result.legal_basis).toEqual(['12012E016', '12012E114'])
    })

    it('M6d – directory codes preserve combined and label-less entries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            // one entry with a label, one entry that is a bare code tail (no label)
            dirCodes: { type: 'literal', value: '152020: Consumer information|||1940' },
          }),
      })

      const result = await client.metadataQuery('32016R0679', 'DEU')
      expect(result.directory_codes).toEqual(['152020: Consumer information', '1940'])
    })

    it('M7 – returns null dates and empty arrays for missing optional fields', async () => {
      const minimalBinding = {
        title: { type: 'literal', value: 'Minimal document' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(minimalBinding),
      })

      const result = await client.metadataQuery('32021R0694', 'DEU')

      expect(result.title).toBe('Minimal document')
      expect(result.date_document).toBeNull()
      expect(result.date_entry_into_force).toBeNull()
      expect(result.date_end_of_validity).toBeNull()
      expect(result.in_force).toBeNull()
      expect(result.date_transposition).toBeNull()
      expect(result.resource_type).toBe('')
      expect(result.authors).toEqual([])
      expect(result.eurovoc_concepts).toEqual([])
      expect(result.directory_codes).toEqual([])
      expect(result.legal_basis).toEqual([])
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
      // Each case below queries the *same* celexId/language — metadataQuery()
      // now caches by that key (Task 6), so a fresh client per case is
      // required here to actually exercise each mocked response instead of
      // serving the first one's cached result.

      // true case
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMetadataSparqlResponse({
            ...fullBinding,
            inForce: { type: 'literal', value: 'true' },
          }),
      })
      const resultTrue = await new CellarClient().metadataQuery('32021R0694', 'DEU')
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
      const resultFalse = await new CellarClient().metadataQuery('32021R0694', 'DEU')
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
      const result1 = await new CellarClient().metadataQuery('32021R0694', 'DEU')
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
      const result0 = await new CellarClient().metadataQuery('32021R0694', 'DEU')
      expect(result0.in_force).toBe(false)

      // missing case
      const { inForce: _removed, ...bindingNoForce } = fullBinding
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(bindingNoForce),
      })
      const resultNull = await new CellarClient().metadataQuery('32021R0694', 'DEU')
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
            legalBases: { type: 'literal', value: '' },
          }),
      })

      const result = await client.metadataQuery('32021R0694', 'DEU')

      expect(result.authors).toEqual(['Author A', 'Author B', 'Author C'])
      expect(result.eurovoc_concepts).toEqual(['concept1'])
      expect(result.directory_codes).toEqual([])
      expect(result.legal_basis).toEqual([])
    })
  })

  // =========================================================================
  // metadataQuery() caching (Task 6)
  // =========================================================================
  describe('metadataQuery() caching', () => {
    function makeMetadataSparqlResponse(binding: Record<string, { type: string; value: string }>) {
      return { results: { bindings: [binding] } }
    }

    const minimalBinding = { title: { type: 'literal', value: 'Minimal document' } }

    it('CACHE-M1 – caches a successful result: two identical calls hit fetch once', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(minimalBinding),
      })

      const cachingClient = new CellarClient()
      const first = await cachingClient.metadataQuery('32021R0694', 'DEU')
      const second = await cachingClient.metadataQuery('32021R0694', 'DEU')

      expect(first.title).toBe('Minimal document')
      expect(second.title).toBe('Minimal document')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('CACHE-M2 – does NOT cache a "not found" error: the second call retries against fetch', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })

      const cachingClient = new CellarClient()
      await expect(cachingClient.metadataQuery('39999X0000', 'DEU')).rejects.toThrow(
        'No metadata found for CELEX: 39999X0000',
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(minimalBinding),
      })
      const second = await cachingClient.metadataQuery('39999X0000', 'DEU')

      expect(second.title).toBe('Minimal document')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('CACHE-M3 – a different language produces a different cache entry', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => makeMetadataSparqlResponse(minimalBinding) })
        .mockResolvedValueOnce({ ok: true, json: async () => makeMetadataSparqlResponse(minimalBinding) })

      const cachingClient = new CellarClient()
      await cachingClient.metadataQuery('32021R0694', 'DEU')
      await cachingClient.metadataQuery('32021R0694', 'ENG')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('CACHE-M4 – expires after the injected clock advances past the 6h TTL', async () => {
      let now = 0
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => makeMetadataSparqlResponse(minimalBinding) })
        .mockResolvedValueOnce({ ok: true, json: async () => makeMetadataSparqlResponse(minimalBinding) })

      const cachingClient = new CellarClient({ now: () => now })
      await cachingClient.metadataQuery('32021R0694', 'DEU')

      now += 6 * 60 * 60 * 1000 // exactly 6h later — TTL boundary, must be expired
      await cachingClient.metadataQuery('32021R0694', 'DEU')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('CACHE-M5 – mutating a returned result does not affect a subsequent cache hit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeMetadataSparqlResponse(minimalBinding),
      })

      const cachingClient = new CellarClient()
      const first = await cachingClient.metadataQuery('32021R0694', 'DEU')
      first.title = 'MUTATED'

      const second = await cachingClient.metadataQuery('32021R0694', 'DEU')

      expect(second.title).toBe('Minimal document')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})
