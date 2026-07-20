import { describe, it, expect } from 'vitest'
import { summarySchema } from '../src/schemas/summarySchema.js'

describe('summarySchema', () => {
  it('SS1 – accepts a valid CELEX with defaults for the rest', () => {
    const parsed = summarySchema.parse({ celex_id: '32016R0679' })
    expect(parsed.celex_id).toBe('32016R0679')
    expect(parsed.language).toBe('ENG') // default
    expect(parsed.max_chars).toBe(20000) // default
    expect(parsed.offset).toBe(0) // default
  })

  it('SS2 – rejects a malformed CELEX', () => {
    expect(() => summarySchema.parse({ celex_id: 'not a celex!' })).toThrow()
  })

  it('SS3 – requires celex_id', () => {
    expect(() => summarySchema.parse({})).toThrow()
  })

  it('SS4 – accepts any of the 24 language codes and rejects a fantasy code', () => {
    expect(summarySchema.parse({ celex_id: '32016R0679', language: 'POL' }).language).toBe('POL')
    expect(() => summarySchema.parse({ celex_id: '32016R0679', language: 'XXX' })).toThrow()
  })

  it('SS5 – enforces max_chars bounds (1000..50000)', () => {
    expect(() => summarySchema.parse({ celex_id: '32016R0679', max_chars: 999 })).toThrow()
    expect(() => summarySchema.parse({ celex_id: '32016R0679', max_chars: 50001 })).toThrow()
    expect(summarySchema.parse({ celex_id: '32016R0679', max_chars: 5000 }).max_chars).toBe(5000)
  })

  it('SS6 – offset must be a non-negative integer', () => {
    expect(() => summarySchema.parse({ celex_id: '32016R0679', offset: -1 })).toThrow()
    expect(summarySchema.parse({ celex_id: '32016R0679', offset: 4000 }).offset).toBe(4000)
  })

  it('SS7 – is strict: rejects unknown keys', () => {
    expect(() => summarySchema.parse({ celex_id: '32016R0679', foo: 'bar' })).toThrow()
  })
})
