import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  EU_LANGUAGES,
  LANGUAGE_CODES,
  LANGUAGE_ISO_MAP,
  LANGUAGE_ENUM,
} from '../src/languages.js'

// The 24 official EU languages, as the single source of truth is expected to
// declare them. Order-independent: we compare as sets.
const EXPECTED_CODES = [
  'BUL', 'SPA', 'CES', 'DAN', 'DEU', 'EST', 'ELL', 'ENG', 'FRA', 'GLE', 'HRV',
  'ITA', 'LAV', 'LIT', 'HUN', 'MLT', 'NLD', 'POL', 'POR', 'RON', 'SLK', 'SLV',
  'FIN', 'SWE',
]
const EXPECTED_ISO = [
  'bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'ga', 'hr', 'it', 'lv',
  'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv',
]

describe('EU_LANGUAGES table', () => {
  it('L1 – contains exactly 24 official languages', () => {
    expect(EU_LANGUAGES).toHaveLength(24)
  })

  it('L2 – has no duplicate 3-letter codes', () => {
    const codes = EU_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(24)
  })

  it('L3 – has no duplicate ISO-2 codes', () => {
    const isos = EU_LANGUAGES.map((l) => l.iso)
    expect(new Set(isos).size).toBe(24)
  })

  it('L4 – covers exactly the expected Cellar 3-letter codes', () => {
    const codes = EU_LANGUAGES.map((l) => l.code)
    expect(new Set(codes)).toEqual(new Set(EXPECTED_CODES))
  })

  it('L5 – covers exactly the expected ISO 639-1 two-letter codes', () => {
    const isos = EU_LANGUAGES.map((l) => l.iso)
    expect(new Set(isos)).toEqual(new Set(EXPECTED_ISO))
  })

  it('L6 – every code is 3 uppercase A–Z letters, every iso is 2 lowercase a–z letters', () => {
    for (const { code, iso } of EU_LANGUAGES) {
      expect(code).toMatch(/^[A-Z]{3}$/)
      expect(iso).toMatch(/^[a-z]{2}$/)
    }
  })

  it('L7 – pairs each expected code with its expected iso (URI↔ISO consistency)', () => {
    // Position-aligned expected pairs — this is the authoritative mapping.
    const expectedPairs = EXPECTED_CODES.map((code, i) => [code, EXPECTED_ISO[i]])
    const actualPairs = EU_LANGUAGES.map((l) => [l.code, l.iso])
    expect(new Set(actualPairs.map((p) => p.join('=')))).toEqual(
      new Set(expectedPairs.map((p) => p.join('='))),
    )
  })
})

describe('LANGUAGE_CODES', () => {
  it('L8 – lists all 24 codes and includes non-DE/EN/FR ones', () => {
    expect(LANGUAGE_CODES).toHaveLength(24)
    expect(LANGUAGE_CODES).toContain('POL')
    expect(LANGUAGE_CODES).toContain('SPA')
  })
})

describe('LANGUAGE_ISO_MAP', () => {
  it('L9 – has one entry per language, consistent with the table', () => {
    expect(Object.keys(LANGUAGE_ISO_MAP)).toHaveLength(24)
    for (const { code, iso } of EU_LANGUAGES) {
      expect(LANGUAGE_ISO_MAP[code]).toBe(iso)
    }
  })

  it('L10 – maps the well-known codes to their ISO tags', () => {
    expect(LANGUAGE_ISO_MAP.DEU).toBe('de')
    expect(LANGUAGE_ISO_MAP.ENG).toBe('en')
    expect(LANGUAGE_ISO_MAP.FRA).toBe('fr')
    expect(LANGUAGE_ISO_MAP.POL).toBe('pl')
    expect(LANGUAGE_ISO_MAP.SPA).toBe('es')
  })
})

describe('LANGUAGE_ENUM', () => {
  it('L11 – accepts every one of the 24 codes', () => {
    for (const { code } of EU_LANGUAGES) {
      expect(LANGUAGE_ENUM.parse(code)).toBe(code)
    }
  })

  it('L12 – accepts a non-DE/EN/FR code (POL)', () => {
    expect(LANGUAGE_ENUM.parse('POL')).toBe('POL')
  })

  it('L13 – rejects a fantasy code', () => {
    expect(() => LANGUAGE_ENUM.parse('XXX')).toThrow(ZodError)
    expect(() => LANGUAGE_ENUM.parse('POLISH')).toThrow(ZodError)
  })

  it('L14 – rejects the lowercase ISO form (must be the 3-letter code)', () => {
    expect(() => LANGUAGE_ENUM.parse('pl')).toThrow(ZodError)
    expect(() => LANGUAGE_ENUM.parse('de')).toThrow(ZodError)
  })
})
