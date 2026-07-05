import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { fetchSchema, fetchInputSchema } from '../src/schemas/fetchSchema.js'

describe('fetchSchema', () => {
  it('F1 – accepts standard CELEX ID', () => {
    const result = fetchSchema.parse({ celex_id: '32024R1689' })
    expect(result.celex_id).toBe('32024R1689')
  })

  it('F2 – accepts CELEX ID with parentheses (corrigenda)', () => {
    const result = fetchSchema.parse({ celex_id: '32023D2454(02)' })
    expect(result.celex_id).toBe('32023D2454(02)')
  })

  it('F3 – rejects dangerous characters like <script>', () => {
    expect(() => fetchSchema.parse({ celex_id: '<script>' })).toThrow(ZodError)
    expect(() => fetchSchema.parse({ celex_id: '32024R1689<x>' })).toThrow(ZodError)
  })

  it('F4 – rejects empty and too-short IDs', () => {
    expect(() => fetchSchema.parse({ celex_id: '' })).toThrow(ZodError)
    expect(() => fetchSchema.parse({ celex_id: '3AB' })).toThrow(ZodError)
  })

  it('F5 – offset defaults to 0', () => {
    const result = fetchSchema.parse({ celex_id: '32024R1689' })
    expect(result.offset).toBe(0)
  })

  it('F6 – accepts an explicit non-negative offset', () => {
    const result = fetchSchema.parse({ celex_id: '32024R1689', offset: 20000 })
    expect(result.offset).toBe(20000)
  })

  it('F7 – rejects a negative offset', () => {
    expect(() => fetchSchema.parse({ celex_id: '32024R1689', offset: -1 })).toThrow(ZodError)
  })

  it('F8 – rejects a non-integer offset', () => {
    expect(() => fetchSchema.parse({ celex_id: '32024R1689', offset: 1.5 })).toThrow(ZodError)
  })

  // -------------------------------------------------------------------------
  // Task 2: eli / oj_ref fields + XOR (fetchInputSchema)
  // -------------------------------------------------------------------------
  it('F9 – base schema accepts an eli input', () => {
    const result = fetchSchema.parse({ eli: 'reg/2016/679' })
    expect(result.eli).toBe('reg/2016/679')
    expect(result.language).toBe('DEU')
  })

  it('F10 – base schema accepts an oj_ref input', () => {
    const result = fetchSchema.parse({ oj_ref: 'OJ:L_202401689' })
    expect(result.oj_ref).toBe('OJ:L_202401689')
  })

  it('F11 – fetchInputSchema accepts exactly one identifier', () => {
    expect(() => fetchInputSchema.parse({ celex_id: '32024R1689' })).not.toThrow()
    expect(() => fetchInputSchema.parse({ eli: 'reg/2016/679' })).not.toThrow()
    expect(() => fetchInputSchema.parse({ oj_ref: 'OJ:L_202401689' })).not.toThrow()
  })

  it('F12 – fetchInputSchema rejects two identifiers at once', () => {
    expect(() =>
      fetchInputSchema.parse({ celex_id: '32024R1689', eli: 'reg/2016/679' })
    ).toThrow(/only one identifier/i)
    expect(() =>
      fetchInputSchema.parse({ eli: 'reg/2016/679', oj_ref: 'OJ:L_202401689' })
    ).toThrow(/only one identifier/i)
  })

  it('F13 – fetchInputSchema rejects when no identifier is given', () => {
    expect(() => fetchInputSchema.parse({ language: 'ENG' })).toThrow(
      /exactly one identifier/i
    )
  })
})
