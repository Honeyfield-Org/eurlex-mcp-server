import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { searchSchema } from '../src/schemas/searchSchema.js'

describe('searchSchema', () => {
  // ---- query length boundaries ----
  it('SS1 – rejects query shorter than 3 characters', () => {
    expect(() => searchSchema.parse({ query: 'ab' })).toThrow(ZodError)
  })

  it('SS2 – accepts query with exactly 3 characters', () => {
    const result = searchSchema.parse({ query: 'abc' })
    expect(result.query).toBe('abc')
  })

  it('SS3 – accepts query with 500 characters', () => {
    const longQuery = 'a'.repeat(500)
    const result = searchSchema.parse({ query: longQuery })
    expect(result.query).toBe(longQuery)
  })

  it('SS4 – rejects query longer than 500 characters', () => {
    expect(() => searchSchema.parse({ query: 'a'.repeat(501) })).toThrow(ZodError)
  })

  // ---- date_from / date_to regex ----
  it('SS5 – accepts valid date_from in YYYY-MM-DD format', () => {
    const result = searchSchema.parse({ query: 'test', date_from: '2021-01-15' })
    expect(result.date_from).toBe('2021-01-15')
  })

  it('SS6 – rejects date_from in wrong format', () => {
    expect(() => searchSchema.parse({ query: 'test', date_from: '15-01-2021' })).toThrow(ZodError)
    expect(() => searchSchema.parse({ query: 'test', date_from: '2021/01/15' })).toThrow(ZodError)
    expect(() => searchSchema.parse({ query: 'test', date_from: 'not-a-date' })).toThrow(ZodError)
  })

  it('SS7 – accepts valid date_to in YYYY-MM-DD format', () => {
    const result = searchSchema.parse({ query: 'test', date_to: '2024-12-31' })
    expect(result.date_to).toBe('2024-12-31')
  })

  it('SS8 – rejects date_to in wrong format', () => {
    expect(() => searchSchema.parse({ query: 'test', date_to: '31-12-2024' })).toThrow(ZodError)
    expect(() => searchSchema.parse({ query: 'test', date_to: '2024.12.31' })).toThrow(ZodError)
  })

  // ---- limit boundaries ----
  it('SS9 – rejects limit below 1', () => {
    expect(() => searchSchema.parse({ query: 'test', limit: 0 })).toThrow(ZodError)
  })

  it('SS10 – accepts limit of 1', () => {
    const result = searchSchema.parse({ query: 'test', limit: 1 })
    expect(result.limit).toBe(1)
  })

  it('SS11 – accepts limit of 50', () => {
    const result = searchSchema.parse({ query: 'test', limit: 50 })
    expect(result.limit).toBe(50)
  })

  it('SS12 – rejects limit above 50', () => {
    expect(() => searchSchema.parse({ query: 'test', limit: 51 })).toThrow(ZodError)
  })

  it('SS13 – defaults limit to 10', () => {
    const result = searchSchema.parse({ query: 'test' })
    expect(result.limit).toBe(10)
  })

  // ---- resource_type ----
  it('SS14 – accepts all known resource types', () => {
    for (const rt of ['REG', 'DIR', 'DEC', 'JUDG', 'REG_IMPL', 'REG_DEL', 'DIR_IMPL', 'DIR_DEL', 'DEC_IMPL', 'DEC_DEL', 'ORDER', 'OPIN_AG', 'RECO', 'any']) {
      const result = searchSchema.parse({ query: 'test', resource_type: rt })
      expect(result.resource_type).toBe(rt)
    }
  })

  it('SS15 – rejects unknown resource type', () => {
    expect(() => searchSchema.parse({ query: 'test', resource_type: 'UNKNOWN' })).toThrow(ZodError)
  })

  it('SS16 – defaults resource_type to any', () => {
    const result = searchSchema.parse({ query: 'test' })
    expect(result.resource_type).toBe('any')
  })

  // ---- language enum (all 24 official EU languages) ----
  it('SS18 – accepts a non-DE/EN/FR language code (POL)', () => {
    const result = searchSchema.parse({ query: 'test', language: 'POL' })
    expect(result.language).toBe('POL')
  })

  it('SS19 – accepts further non-legacy codes (SPA, SWE, GLE)', () => {
    for (const lang of ['SPA', 'SWE', 'GLE']) {
      expect(searchSchema.parse({ query: 'test', language: lang }).language).toBe(lang)
    }
  })

  it('SS20 – rejects a fantasy language code', () => {
    expect(() => searchSchema.parse({ query: 'test', language: 'XX' })).toThrow(ZodError)
    expect(() => searchSchema.parse({ query: 'test', language: 'POLISH' })).toThrow(ZodError)
  })

  it('SS21 – defaults language to DEU', () => {
    expect(searchSchema.parse({ query: 'test' }).language).toBe('DEU')
  })

  // ---- strict mode ----
  it('SS17 – rejects extra fields in strict mode', () => {
    expect(() => searchSchema.parse({ query: 'test', extra: 'field' })).toThrow(ZodError)
  })
})
