import { describe, it, expect } from 'vitest'
import { transpositionSchema } from '../src/schemas/transpositionSchema.js'

describe('transpositionSchema', () => {
  it('TS1 – applies defaults for language and limit', () => {
    const parsed = transpositionSchema.parse({ celex_id: '32022L2555' })
    expect(parsed.language).toBe('ENG')
    expect(parsed.limit).toBe(20)
    expect(parsed.country).toBeUndefined()
  })

  it('TS2 – requires celex_id', () => {
    expect(() => transpositionSchema.parse({})).toThrow()
  })

  it('TS3 – rejects a malformed CELEX', () => {
    expect(() => transpositionSchema.parse({ celex_id: 'x' })).toThrow()
    expect(() => transpositionSchema.parse({ celex_id: '!!' })).toThrow()
  })

  it('TS4 – accepts a valid member-state country code', () => {
    expect(transpositionSchema.parse({ celex_id: '32022L2555', country: 'AT' }).country).toBe('AT')
    expect(transpositionSchema.parse({ celex_id: '32022L2555', country: 'EL' }).country).toBe('EL')
  })

  it('TS5 – rejects a non-member-state / lowercase country code', () => {
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', country: 'GR' })).toThrow()
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', country: 'de' })).toThrow()
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', country: 'XX' })).toThrow()
  })

  it('TS6 – enforces the limit bounds (1–100)', () => {
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', limit: 0 })).toThrow()
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', limit: 101 })).toThrow()
    expect(transpositionSchema.parse({ celex_id: '32022L2555', limit: 100 }).limit).toBe(100)
  })

  it('TS7 – accepts any of the 24 languages, rejects a fantasy code', () => {
    expect(transpositionSchema.parse({ celex_id: '32022L2555', language: 'POL' }).language).toBe(
      'POL',
    )
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', language: 'XXX' })).toThrow()
  })

  it('TS8 – rejects unknown keys (strict)', () => {
    expect(() => transpositionSchema.parse({ celex_id: '32022L2555', foo: 'bar' })).toThrow()
  })
})
