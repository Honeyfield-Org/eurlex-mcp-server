import { describe, it, expect } from 'vitest'
import { citationsSchema } from '../src/schemas/citationsSchema.js'

describe('citationsSchema', () => {
  it('C1 – accepts valid CELEX-ID with defaults', () => {
    const result = citationsSchema.parse({ celex_id: '32024R1689' })
    expect(result.celex_id).toBe('32024R1689')
    expect(result.language).toBe('DEU')
    expect(result.direction).toBe('both')
    expect(result.limit).toBe(20)
  })

  it('C2 – accepts direction=cited_by', () => {
    const result = citationsSchema.parse({ celex_id: '32024R1689', direction: 'cited_by' })
    expect(result.direction).toBe('cited_by')
  })

  it('C3 – accepts direction=cites', () => {
    const result = citationsSchema.parse({ celex_id: '32024R1689', direction: 'cites' })
    expect(result.direction).toBe('cites')
  })

  it('C4 – rejects invalid CELEX-ID', () => {
    expect(() => citationsSchema.parse({ celex_id: 'bad' })).toThrow()
  })

  it('C4a – accepts CELEX ID with parentheses (corrigenda)', () => {
    const result = citationsSchema.parse({ celex_id: '32023D2454(02)' })
    expect(result.celex_id).toBe('32023D2454(02)')
  })

  it('C4b – rejects dangerous characters', () => {
    expect(() => citationsSchema.parse({ celex_id: '<script>' })).toThrow()
    expect(() => citationsSchema.parse({ celex_id: '32024R1689{x}' })).toThrow()
  })

  it('rejects limit below 1', () => {
    expect(() => citationsSchema.parse({ celex_id: '32024R1689', limit: 0 })).toThrow()
  })

  it('rejects limit above 100', () => {
    expect(() => citationsSchema.parse({ celex_id: '32024R1689', limit: 101 })).toThrow()
  })

  it('accepts limit of 100', () => {
    const result = citationsSchema.parse({ celex_id: '32024R1689', limit: 100 })
    expect(result.limit).toBe(100)
  })

  it('accepts all three direction values', () => {
    for (const dir of ['cites', 'cited_by', 'both'] as const) {
      const result = citationsSchema.parse({ celex_id: '32024R1689', direction: dir })
      expect(result.direction).toBe(dir)
    }
  })

  it('rejects unknown direction', () => {
    expect(() => citationsSchema.parse({ celex_id: '32024R1689', direction: 'unknown' })).toThrow()
  })

  it('rejects unknown language', () => {
    // 'ITA' is now valid (Italian is one of the 24 EU languages); use a fantasy code.
    expect(() => citationsSchema.parse({ celex_id: '32024R1689', language: 'XXX' })).toThrow()
  })

  it('accepts a non-DE/EN/FR language (ITA)', () => {
    const result = citationsSchema.parse({ celex_id: '32024R1689', language: 'ITA' })
    expect(result.language).toBe('ITA')
  })
})
