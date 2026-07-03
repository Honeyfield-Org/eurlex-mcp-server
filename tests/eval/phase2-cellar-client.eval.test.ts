import { describe, it, expect } from 'vitest'
import { CellarClient, escapeSparqlString } from '../../src/services/cellarClient.js'
import type { SparqlQueryParams } from '../../src/types.js'

describe('Phase 2 Eval – CellarClient', () => {
  describe('class instantiation', () => {
    it('CellarClient is importable and instantiable', () => {
      const client = new CellarClient()
      expect(client).toBeInstanceOf(CellarClient)
    })
  })

  describe('public API surface', () => {
    const client = new CellarClient()

    it('has sparqlQuery method', () => {
      expect(typeof client.sparqlQuery).toBe('function')
    })

    it('has fetchDocument method', () => {
      expect(typeof client.fetchDocument).toBe('function')
    })

    it('has buildSparqlQuery method', () => {
      expect(typeof client.buildSparqlQuery).toBe('function')
    })
  })

  describe('escapeSparqlString', () => {
    it('is exported as a function', () => {
      expect(typeof escapeSparqlString).toBe('function')
    })

    it('escapes double quotes', () => {
      expect(escapeSparqlString('say "hello"')).toBe('say \\"hello\\"')
    })

    it('escapes backslashes', () => {
      expect(escapeSparqlString('path\\to')).toBe('path\\\\to')
    })

    it('escapes both backslashes and quotes', () => {
      expect(escapeSparqlString('a\\b"c')).toBe('a\\\\b\\"c')
    })

    it('returns plain string unchanged', () => {
      expect(escapeSparqlString('hello world')).toBe('hello world')
    })
  })

  describe('buildSparqlQuery', () => {
    const client = new CellarClient()

    const baseParams: SparqlQueryParams = {
      query: 'Datenschutz',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    }

    it('contains PREFIX cdm:', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      expect(sparql).toContain('PREFIX cdm:')
    })

    it('contains SELECT DISTINCT', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      expect(sparql).toContain('SELECT DISTINCT')
    })

    it('contains FILTER(CONTAINS for search term', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      expect(sparql).toContain('FILTER(CONTAINS')
      expect(sparql).toContain('Datenschutz')
    })

    it('contains LIMIT', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      expect(sparql).toContain('LIMIT 30')
    })

    it('with resource_type=REG contains resource-type/REG', () => {
      const params: SparqlQueryParams = { ...baseParams, resource_type: 'REG' }
      const sparql = client.buildSparqlQuery(params)
      expect(sparql).toContain('resource-type/REG')
    })

    it('with resource_type=any does NOT contain work_has_resource-type filter URI', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      // Should not have a fixed resource-type URI filter, only the binding
      const lines = sparql.split('\n')
      const resourceTypeFilterLines = lines.filter(
        (line) => line.includes('resource-type/') && line.includes('work_has_resource-type')
      )
      expect(resourceTypeFilterLines).toHaveLength(0)
    })

    it('with date_from contains date filter', () => {
      const params: SparqlQueryParams = { ...baseParams, date_from: '2020-01-01' }
      const sparql = client.buildSparqlQuery(params)
      expect(sparql).toContain('2020-01-01')
      expect(sparql).toContain('xsd:date')
    })

    it('title triple is required (not OPTIONAL)', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      // expression_title must appear outside an OPTIONAL block
      const lines = sparql.split('\n')
      const titleLine = lines.find((l) => l.includes('expression_title'))
      expect(titleLine).toBeDefined()
      expect(titleLine).not.toContain('OPTIONAL')
    })

    it('contains BIND for resType', () => {
      const sparql = client.buildSparqlQuery(baseParams)
      expect(sparql).toContain('BIND')
      expect(sparql).toContain('resType')
    })
  })
})
