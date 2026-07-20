import { describe, it, expect } from 'vitest'
import { eurovocSchema } from '../src/schemas/eurovocSchema.js'

describe('eurovocSchema', () => {
  it('E1 – accepts concept label with defaults', () => {
    const result = eurovocSchema.parse({ concept: 'artificial intelligence' })
    expect(result.concept).toBe('artificial intelligence')
    expect(result.resource_type).toBe('any')
    expect(result.language).toBe('ENG')
    expect(result.limit).toBe(10)
  })

  it('E2 – accepts concept as EuroVoc URI', () => {
    const result = eurovocSchema.parse({ concept: 'http://eurovoc.europa.eu/4424' })
    expect(result.concept).toBe('http://eurovoc.europa.eu/4424')
  })

  it('E3 – requires concept min 2 chars', () => {
    expect(() => eurovocSchema.parse({ concept: 'a' })).toThrow()
  })

  it('rejects concept over 500 chars', () => {
    expect(() => eurovocSchema.parse({ concept: 'x'.repeat(501) })).toThrow()
  })

  it('rejects limit below 1', () => {
    expect(() => eurovocSchema.parse({ concept: 'test', limit: 0 })).toThrow()
  })

  it('rejects limit above 50', () => {
    expect(() => eurovocSchema.parse({ concept: 'test', limit: 51 })).toThrow()
  })

  it('accepts limit of 50', () => {
    const result = eurovocSchema.parse({ concept: 'test', limit: 50 })
    expect(result.limit).toBe(50)
  })
})
