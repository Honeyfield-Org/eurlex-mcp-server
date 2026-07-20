import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDefaultLanguage } from '../src/languages.js'

describe('resolveDefaultLanguage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DL1 – undefined → ENG, no warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveDefaultLanguage(undefined)).toBe('ENG')
    expect(spy).not.toHaveBeenCalled()
  })

  it('DL2 – empty string → ENG, no warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveDefaultLanguage('')).toBe('ENG')
    expect(spy).not.toHaveBeenCalled()
  })

  it('DL3 – whitespace-only → ENG, no warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveDefaultLanguage('   ')).toBe('ENG')
    expect(spy).not.toHaveBeenCalled()
  })

  it('DL4 – valid uppercase code returned as-is', () => {
    expect(resolveDefaultLanguage('DEU')).toBe('DEU')
    expect(resolveDefaultLanguage('FRA')).toBe('FRA')
    expect(resolveDefaultLanguage('ENG')).toBe('ENG')
  })

  it('DL5 – lowercase / mixed case / padded → normalized to uppercase code', () => {
    expect(resolveDefaultLanguage('deu')).toBe('DEU')
    expect(resolveDefaultLanguage(' fra ')).toBe('FRA')
    expect(resolveDefaultLanguage('PoL')).toBe('POL')
  })

  it('DL6 – invalid value → ENG plus a single stderr warning naming the value + env var', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveDefaultLanguage('XXX')).toBe('ENG')
    expect(spy).toHaveBeenCalledTimes(1)
    const message = spy.mock.calls[0]?.[0] as string
    expect(message).toContain('XXX')
    expect(message).toContain('EURLEX_DEFAULT_LANGUAGE')
    expect(message).toContain('ENG')
  })

  it('DL7 – near-miss values (ISO alpha-2, English word) → ENG with warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveDefaultLanguage('DE')).toBe('ENG')
    expect(resolveDefaultLanguage('english')).toBe('ENG')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
