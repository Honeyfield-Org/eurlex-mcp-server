import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { metadataSchema, metadataInputSchema } from '../src/schemas/metadataSchema.js'

// ===========================================================================
// Tests M1-M6: metadataSchema validation
// ===========================================================================
describe('metadataSchema', () => {
  it('M1 – valid CELEX ID with default language → parse succeeds, language defaults to "DEU"', () => {
    const result = metadataSchema.parse({ celex_id: '32024R1689' })

    expect(result.celex_id).toBe('32024R1689')
    expect(result.language).toBe('DEU')
  })

  it('M2 – valid CELEX ID with explicit language "ENG" → parse succeeds', () => {
    const result = metadataSchema.parse({ celex_id: '32024R1689', language: 'ENG' })

    expect(result.celex_id).toBe('32024R1689')
    expect(result.language).toBe('ENG')
  })

  it('M3 – invalid CELEX ID throws ZodError', () => {
    expect(() => metadataSchema.parse({ celex_id: 'invalid' })).toThrow(ZodError)
    expect(() => metadataSchema.parse({ celex_id: 'abc' })).toThrow(ZodError)
    expect(() => metadataSchema.parse({ celex_id: '' })).toThrow(ZodError)
  })

  it('M4 – extra fields rejected in strict mode', () => {
    expect(() =>
      metadataSchema.parse({ celex_id: '32024R1689', language: 'DEU', extra: 'field' })
    ).toThrow(ZodError)
  })

  it('M5 – all three languages accepted', () => {
    for (const lang of ['DEU', 'ENG', 'FRA'] as const) {
      const result = metadataSchema.parse({ celex_id: '32024R1689', language: lang })
      expect(result.language).toBe(lang)
    }
  })

  it('M6 – invalid language rejected', () => {
    expect(() =>
      metadataSchema.parse({ celex_id: '32024R1689', language: 'ESP' })
    ).toThrow(ZodError)
  })

  it('M7 – accepts CELEX ID with parentheses (corrigenda)', () => {
    const result = metadataSchema.parse({ celex_id: '32023D2454(02)' })
    expect(result.celex_id).toBe('32023D2454(02)')
  })

  it('M8 – rejects dangerous characters', () => {
    expect(() => metadataSchema.parse({ celex_id: '<script>' })).toThrow(ZodError)
    expect(() => metadataSchema.parse({ celex_id: '32024R1689{x}' })).toThrow(ZodError)
  })

  // -------------------------------------------------------------------------
  // Task 2: eli / oj_ref fields + XOR (metadataInputSchema)
  // -------------------------------------------------------------------------
  it('M9 – base schema accepts eli and oj_ref inputs', () => {
    expect(metadataSchema.parse({ eli: 'reg/2016/679' }).eli).toBe('reg/2016/679')
    expect(metadataSchema.parse({ oj_ref: 'OJ:L_202401689' }).oj_ref).toBe('OJ:L_202401689')
  })

  it('M10 – metadataInputSchema accepts exactly one identifier', () => {
    expect(() => metadataInputSchema.parse({ celex_id: '32024R1689' })).not.toThrow()
    expect(() => metadataInputSchema.parse({ eli: 'reg/2016/679' })).not.toThrow()
    expect(() => metadataInputSchema.parse({ oj_ref: 'OJ:L_202401689' })).not.toThrow()
  })

  it('M11 – metadataInputSchema rejects two identifiers at once', () => {
    expect(() =>
      metadataInputSchema.parse({ celex_id: '32024R1689', oj_ref: 'OJ:L_202401689' })
    ).toThrow(/only one identifier/i)
  })

  it('M12 – metadataInputSchema rejects when no identifier is given', () => {
    expect(() => metadataInputSchema.parse({ language: 'ENG' })).toThrow(
      /exactly one identifier/i
    )
  })
})
