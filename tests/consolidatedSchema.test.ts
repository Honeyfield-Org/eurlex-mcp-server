import { describe, it, expect } from 'vitest'
import { consolidatedSchema } from '../src/schemas/consolidatedSchema.js'

describe('consolidatedSchema', () => {
  it('CO1 – accepts type/year/number with defaults', () => {
    const result = consolidatedSchema.parse({ doc_type: 'reg', year: 2024, number: 1689 })
    expect(result.language).toBe('DEU')
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
})
