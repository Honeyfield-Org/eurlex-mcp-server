import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  EU_MEMBER_STATES,
  MEMBER_STATE_CODES,
  COUNTRY_ENUM,
  MS_ALPHA2_TO_ALPHA3,
  MS_ALPHA3_TO_ALPHA2,
} from '../src/countries.js'

const EXPECTED_ALPHA2 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE',
]
const EXPECTED_ALPHA3 = [
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU',
  'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT',
  'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
]

describe('EU_MEMBER_STATES table', () => {
  it('CT1 – contains exactly 27 member states', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27)
  })

  it('CT2 – has no duplicate alpha-2 or alpha-3 codes', () => {
    expect(new Set(EU_MEMBER_STATES.map((m) => m.alpha2)).size).toBe(27)
    expect(new Set(EU_MEMBER_STATES.map((m) => m.alpha3)).size).toBe(27)
  })

  it('CT3 – covers exactly the expected alpha-2 codes (EL for Greece, not GR)', () => {
    expect(new Set(EU_MEMBER_STATES.map((m) => m.alpha2))).toEqual(new Set(EXPECTED_ALPHA2))
  })

  it('CT4 – covers exactly the expected ISO alpha-3 codes (GRC for Greece)', () => {
    expect(new Set(EU_MEMBER_STATES.map((m) => m.alpha3))).toEqual(new Set(EXPECTED_ALPHA3))
  })

  it('CT5 – alpha-2 is 2 uppercase letters, alpha-3 is 3 uppercase letters', () => {
    for (const { alpha2, alpha3 } of EU_MEMBER_STATES) {
      expect(alpha2).toMatch(/^[A-Z]{2}$/)
      expect(alpha3).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('CT6 – pairs each expected alpha-2 with its expected alpha-3 (position-aligned)', () => {
    const expected = EXPECTED_ALPHA2.map((a2, i) => `${a2}=${EXPECTED_ALPHA3[i]}`)
    const actual = EU_MEMBER_STATES.map((m) => `${m.alpha2}=${m.alpha3}`)
    expect(new Set(actual)).toEqual(new Set(expected))
  })
})

describe('MEMBER_STATE_CODES + COUNTRY_ENUM', () => {
  it('CT7 – lists all 27 alpha-2 codes', () => {
    expect(MEMBER_STATE_CODES).toHaveLength(27)
    expect(MEMBER_STATE_CODES).toContain('DE')
    expect(MEMBER_STATE_CODES).toContain('EL')
  })

  it('CT8 – enum accepts every member-state code', () => {
    for (const { alpha2 } of EU_MEMBER_STATES) {
      expect(COUNTRY_ENUM.parse(alpha2)).toBe(alpha2)
    }
  })

  it('CT9 – enum rejects non-member-state and lowercase codes', () => {
    expect(() => COUNTRY_ENUM.parse('GR')).toThrow(ZodError) // EU uses EL, not GR
    expect(() => COUNTRY_ENUM.parse('GB')).toThrow(ZodError) // UK is not a member state
    expect(() => COUNTRY_ENUM.parse('de')).toThrow(ZodError)
    expect(() => COUNTRY_ENUM.parse('DEU')).toThrow(ZodError)
  })
})

describe('alpha-2 ↔ alpha-3 maps', () => {
  it('CT10 – forward map has 27 entries and round-trips through the reverse map', () => {
    expect(Object.keys(MS_ALPHA2_TO_ALPHA3)).toHaveLength(27)
    for (const { alpha2, alpha3 } of EU_MEMBER_STATES) {
      expect(MS_ALPHA2_TO_ALPHA3[alpha2]).toBe(alpha3)
      expect(MS_ALPHA3_TO_ALPHA2[alpha3]).toBe(alpha2)
    }
  })

  it('CT11 – maps the well-known and EU-specific codes', () => {
    expect(MS_ALPHA2_TO_ALPHA3.DE).toBe('DEU')
    expect(MS_ALPHA2_TO_ALPHA3.EL).toBe('GRC')
    expect(MS_ALPHA2_TO_ALPHA3.IE).toBe('IRL')
    expect(MS_ALPHA3_TO_ALPHA2.GRC).toBe('EL')
    expect(MS_ALPHA3_TO_ALPHA2.ROU).toBe('RO')
  })

  it('CT12 – reverse map has no entry for non-member codes (GBR falls back to raw)', () => {
    expect(MS_ALPHA3_TO_ALPHA2.GBR).toBeUndefined()
  })
})
