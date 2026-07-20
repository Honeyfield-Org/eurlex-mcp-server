import { describe, it, expect } from 'vitest'
import { consolidatedSchema, consolidatedInputSchema } from '../src/schemas/consolidatedSchema.js'

describe('consolidatedSchema', () => {
  it('CO1 – accepts type/year/number with defaults', () => {
    const result = consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689 })
    expect(result.language).toBe('ENG')
    expect(result.format).toBe('xhtml')
  })

  it('CO2 – accepts dir type', () => {
    const result = consolidatedSchema.parse({ doc_type: 'dir', year: 2022, number: 2555 })
    expect(result.doc_type).toBe('dir')
  })

  it('CO3 – rejects year below 1950', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 1900, number: 1 })).toThrow()
  })

  it('rejects year above 2100', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 2101, number: 1 })).toThrow()
  })

  it('rejects number below 1', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 0 })).toThrow()
  })

  it('rejects max_chars below 1000', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1, max_chars: 999 })).toThrow()
  })

  it('rejects max_chars above 50000', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1, max_chars: 50001 })).toThrow()
  })

  it('rejects unknown format', () => {
    expect(() => consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1, format: 'pdf' })).toThrow()
  })

  it('offset defaults to 0', () => {
    const result = consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689 })
    expect(result.offset).toBe(0)
  })

  it('accepts an explicit non-negative offset', () => {
    const result = consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689, offset: 5000 })
    expect(result.offset).toBe(5000)
  })

  it('rejects a negative offset', () => {
    expect(() =>
      consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689, offset: -1 }),
    ).toThrow()
  })

  it('rejects a non-integer offset', () => {
    expect(() =>
      consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689, offset: 1.5 }),
    ).toThrow()
  })

  // -------------------------------------------------------------------------
  // celex_id input (base schema, per-field validation only — the "exactly
  // one input form" invariant is NOT enforced here, only in
  // consolidatedInputSchema below; server.tool(consolidatedSchema.shape) only
  // ever sees this per-field shape).
  // -------------------------------------------------------------------------
  it('CO-CX1 – accepts celex_id alone, doc_type/year/number stay undefined', () => {
    const result = consolidatedSchema.parse({ celex_id: '32016R0679' })
    expect(result.celex_id).toBe('32016R0679')
    expect(result.doc_type).toBeUndefined()
    expect(result.year).toBeUndefined()
    expect(result.number).toBeUndefined()
  })

  it('CO-CX2 – rejects a celex_id with disallowed characters', () => {
    expect(() => consolidatedSchema.parse({ celex_id: '<script>' })).toThrow()
  })

  it('CO-CX3 – doc_type/year/number are optional at the per-field level (no XOR check here)', () => {
    expect(() => consolidatedSchema.parse({})).not.toThrow()
  })
})

// ===========================================================================
// consolidatedInputSchema — celex_id XOR doc_type+year+number (Task 5)
// ===========================================================================
describe('consolidatedInputSchema (celex_id XOR doc_type+year+number)', () => {
  it('CO-XOR1 – accepts celex_id alone', () => {
    const result = consolidatedInputSchema.parse({ celex_id: '32016R0679' })
    expect(result.celex_id).toBe('32016R0679')
  })

  it('CO-XOR2 – accepts doc_type+year+number alone', () => {
    const result = consolidatedInputSchema.parse({ doc_type: 'reg', year: 2016, number: 679 })
    expect(result.doc_type).toBe('reg')
    expect(result.year).toBe(2016)
    expect(result.number).toBe(679)
  })

  it('CO-XOR3 – rejects celex_id and doc_type+year+number provided together', () => {
    expect(() =>
      consolidatedInputSchema.parse({
        celex_id: '32016R0679',
        doc_type: 'reg',
        year: 2016,
        number: 679,
      }),
    ).toThrow()
  })

  it('CO-XOR4 – rejects neither celex_id nor doc_type+year+number provided', () => {
    expect(() => consolidatedInputSchema.parse({})).toThrow()
  })

  it('CO-XOR5 – rejects a partial triple (doc_type only) when celex_id is absent', () => {
    expect(() => consolidatedInputSchema.parse({ doc_type: 'reg' })).toThrow()
  })

  it('CO-XOR6 – rejects a partial triple (year+number, no doc_type) when celex_id is absent', () => {
    expect(() => consolidatedInputSchema.parse({ year: 2016, number: 679 })).toThrow()
  })

  it('CO-XOR7 – rejects celex_id mixed with a single triple field', () => {
    expect(() => consolidatedInputSchema.parse({ celex_id: '32016R0679', year: 2016 })).toThrow()
  })
})
