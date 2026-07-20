import { describe, it, expect } from 'vitest'
import {
  caseLawSchema,
  caseLawInputSchema,
  ECLI_REGEX,
} from '../src/schemas/caseLawSchema.js'

describe('caseLawSchema', () => {
  it('applies defaults for court/type/language/limit', () => {
    const parsed = caseLawSchema.parse({ query: 'Schrems' })
    expect(parsed.court).toBe('any')
    expect(parsed.type).toBe('any')
    expect(parsed.language).toBe('ENG')
    expect(parsed.limit).toBe(10)
  })

  it('accepts a valid ECLI', () => {
    expect(caseLawSchema.parse({ ecli: 'ECLI:EU:C:2014:317' }).ecli).toBe('ECLI:EU:C:2014:317')
    expect(caseLawSchema.parse({ ecli: 'ECLI:EU:T:2007:289' }).ecli).toBe('ECLI:EU:T:2007:289')
  })

  it('accepts a lowercase ECLI (case-insensitive regex; normalization happens client-side)', () => {
    expect(caseLawSchema.parse({ ecli: 'ecli:eu:c:2014:317' }).ecli).toBe('ecli:eu:c:2014:317')
  })

  it('rejects a malformed ECLI', () => {
    expect(() => caseLawSchema.parse({ ecli: 'not-an-ecli' })).toThrow()
    expect(() => caseLawSchema.parse({ ecli: 'ECLI:EU:C:2014' })).toThrow()
  })

  it('ECLI_REGEX matches EU court identifiers', () => {
    expect(ECLI_REGEX.test('ECLI:EU:C:2014:317')).toBe(true)
    expect(ECLI_REGEX.test('ECLI:EU:T:2007:289')).toBe(true)
    expect(ECLI_REGEX.test('ECLI:EU:F:2011:1')).toBe(true)
    expect(ECLI_REGEX.test('random')).toBe(false)
  })

  it('rejects an invalid court/type enum value', () => {
    expect(() => caseLawSchema.parse({ query: 'x', court: 'SUPREME' })).toThrow()
    expect(() => caseLawSchema.parse({ query: 'x', type: 'REG' })).toThrow()
  })

  it('rejects unknown keys (strict)', () => {
    expect(() => caseLawSchema.parse({ query: 'x', foo: 'bar' })).toThrow()
  })

  it('rejects a query shorter than 3 chars', () => {
    expect(() => caseLawSchema.parse({ query: 'ab' })).toThrow()
  })

  it('rejects a bad CELEX for celex_id / related_celex', () => {
    expect(() => caseLawSchema.parse({ celex_id: 'x' })).toThrow()
    expect(() => caseLawSchema.parse({ related_celex: '!' })).toThrow()
  })
})

describe('caseLawInputSchema (at-least-one refinement)', () => {
  it('accepts a single primary input', () => {
    expect(() => caseLawInputSchema.parse({ query: 'Schrems' })).not.toThrow()
    expect(() => caseLawInputSchema.parse({ celex_id: '62012CJ0131' })).not.toThrow()
    expect(() => caseLawInputSchema.parse({ ecli: 'ECLI:EU:C:2014:317' })).not.toThrow()
    expect(() => caseLawInputSchema.parse({ related_celex: '32016R0679' })).not.toThrow()
  })

  it('accepts combined primary inputs', () => {
    expect(() =>
      caseLawInputSchema.parse({ query: 'Schrems', related_celex: '32016R0679' }),
    ).not.toThrow()
  })

  it('rejects when no primary input is provided', () => {
    expect(() => caseLawInputSchema.parse({ court: 'COURT_JUSTICE' })).toThrow(
      /at least one search input/i,
    )
  })
})
