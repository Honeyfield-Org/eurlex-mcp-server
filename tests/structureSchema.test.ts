import { describe, it, expect } from 'vitest'
import { structureSchema, structureInputSchema } from '../src/schemas/structureSchema.js'

describe('structureSchema (per-field shape)', () => {
  it('SS1 – defaults language to ENG', () => {
    expect(structureSchema.parse({ celex_id: '32024R1689' }).language).toBe('ENG')
  })

  it('SS2 – accepts a valid CELEX and rejects a malformed one', () => {
    expect(structureSchema.parse({ celex_id: '32024R1689' }).celex_id).toBe('32024R1689')
    expect(() => structureSchema.parse({ celex_id: '!!' })).toThrow()
  })

  it('SS3 – accepts any of the 24 languages, rejects a fantasy code', () => {
    expect(structureSchema.parse({ celex_id: '32024R1689', language: 'FRA' }).language).toBe('FRA')
    expect(() => structureSchema.parse({ celex_id: '32024R1689', language: 'XXX' })).toThrow()
  })

  it('SS4 – rejects unknown keys (strict)', () => {
    expect(() => structureSchema.parse({ celex_id: '32024R1689', foo: 'bar' })).toThrow()
  })
})

describe('structureInputSchema (XOR refinement)', () => {
  it('SS5 – accepts exactly one identifier (celex_id / eli / oj_ref)', () => {
    expect(structureInputSchema.parse({ celex_id: '32024R1689' }).celex_id).toBe('32024R1689')
    expect(structureInputSchema.parse({ eli: 'reg/2016/679' }).eli).toBe('reg/2016/679')
    expect(structureInputSchema.parse({ oj_ref: 'OJ:L_202401689' }).oj_ref).toBe('OJ:L_202401689')
  })

  it('SS6 – rejects when no identifier is given', () => {
    expect(() => structureInputSchema.parse({})).toThrow(/exactly one identifier/)
  })

  it('SS7 – rejects when more than one identifier is given', () => {
    expect(() =>
      structureInputSchema.parse({ celex_id: '32024R1689', eli: 'reg/2016/679' }),
    ).toThrow(/only one identifier/)
  })
})
