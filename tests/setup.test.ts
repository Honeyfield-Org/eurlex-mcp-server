import { describe, it, expect } from 'vitest'
import { SPARQL_ENDPOINT, CELLAR_REST_BASE, DEFAULT_LIMIT, MAX_CHARS_DEFAULT, MAX_CHARS_LIMIT, RESOURCE_TYPES } from '../src/constants.js'
import { DEFAULT_LANGUAGE } from '../src/languages.js'

describe('Project Setup', () => {
  it('constants are defined correctly', () => {
    expect(SPARQL_ENDPOINT).toBe('https://publications.europa.eu/webapi/rdf/sparql')
    expect(CELLAR_REST_BASE).toBe('https://publications.europa.eu/resource/celex')
    expect(DEFAULT_LANGUAGE).toBe('ENG')
    expect(DEFAULT_LIMIT).toBe(10)
    expect(MAX_CHARS_DEFAULT).toBe(20000)
    expect(MAX_CHARS_LIMIT).toBe(50000)
    expect(RESOURCE_TYPES).toHaveLength(14)
    expect(RESOURCE_TYPES).toContain('REG')
    expect(RESOURCE_TYPES).toContain('any')
  })
})
