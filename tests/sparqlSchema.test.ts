import { describe, it, expect } from 'vitest'
import { sparqlSchema } from '../src/schemas/sparqlSchema.js'

const OK = 'SELECT ?s WHERE { ?s ?p ?o }' // 28 chars

describe('sparqlSchema', () => {
  it('SS1 – accepts a query within the length bounds', () => {
    expect(sparqlSchema.parse({ query: OK }).query).toBe(OK)
  })

  it('SS2 – rejects a query shorter than the minimum length', () => {
    expect(() => sparqlSchema.parse({ query: 'ASK {}' })).toThrow()
  })

  it('SS3 – rejects a query longer than the maximum length', () => {
    expect(() => sparqlSchema.parse({ query: `SELECT ?s WHERE { ?s ?p "${'x'.repeat(5000)}" }` })).toThrow()
  })

  it('SS4 – requires the query field', () => {
    expect(() => sparqlSchema.parse({})).toThrow()
  })

  it('SS5 – rejects unknown keys (strict)', () => {
    expect(() => sparqlSchema.parse({ query: OK, limit: 10 })).toThrow()
  })
})
