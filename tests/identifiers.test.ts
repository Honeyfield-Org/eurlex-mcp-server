import { describe, it, expect } from 'vitest'
import {
  normalizeEliToCanonicalUri,
  normalizeOjRefToResourceUri,
} from '../src/services/identifiers.js'

// ===========================================================================
// Task 2: pure identifier normalization (no network)
// ===========================================================================

describe('normalizeEliToCanonicalUri()', () => {
  it('ID-E1 – short form gets the /oj suffix and the data.europa.eu base', () => {
    expect(normalizeEliToCanonicalUri('reg/2016/679')).toBe(
      'http://data.europa.eu/eli/reg/2016/679/oj'
    )
  })

  it('ID-E2 – full data.europa.eu URL (already /oj) is preserved', () => {
    expect(normalizeEliToCanonicalUri('http://data.europa.eu/eli/reg/2016/679/oj')).toBe(
      'http://data.europa.eu/eli/reg/2016/679/oj'
    )
  })

  it('ID-E3 – full URL without /oj gets the suffix appended', () => {
    expect(normalizeEliToCanonicalUri('http://data.europa.eu/eli/reg/2016/679')).toBe(
      'http://data.europa.eu/eli/reg/2016/679/oj'
    )
  })

  it('ID-E4 – https and the publications.europa.eu resource host both normalize', () => {
    expect(normalizeEliToCanonicalUri('https://data.europa.eu/eli/dir/2022/2555/oj')).toBe(
      'http://data.europa.eu/eli/dir/2022/2555/oj'
    )
    expect(
      normalizeEliToCanonicalUri('http://publications.europa.eu/resource/eli/dec/2013/490/oj')
    ).toBe('http://data.europa.eu/eli/dec/2013/490/oj')
  })

  it('ID-E5 – surrounding whitespace and slashes are trimmed', () => {
    expect(normalizeEliToCanonicalUri('  /reg/2016/679/  ')).toBe(
      'http://data.europa.eu/eli/reg/2016/679/oj'
    )
  })

  it('ID-E6 – unpadded natural number is kept verbatim (matches the stored ELI literal)', () => {
    // 1995 Data Protection Directive: ELI number "46", CELEX is "31995L0046".
    expect(normalizeEliToCanonicalUri('dir/1995/46')).toBe(
      'http://data.europa.eu/eli/dir/1995/46/oj'
    )
  })

  it('ID-E7 – rejects garbage with an example-bearing message', () => {
    expect(() => normalizeEliToCanonicalUri('not-an-eli')).toThrow(/Invalid ELI/)
    expect(() => normalizeEliToCanonicalUri('reg/2016')).toThrow(/reg\/2016\/679/)
    expect(() => normalizeEliToCanonicalUri('')).toThrow(/Invalid ELI/)
  })
})

describe('normalizeOjRefToResourceUri()', () => {
  it('ID-O1 – canonical OJ reference maps to the oj resource URI', () => {
    expect(normalizeOjRefToResourceUri('OJ:L_202401689')).toBe(
      'http://publications.europa.eu/resource/oj/L_202401689'
    )
  })

  it('ID-O2 – prefix and series letter are case-normalized', () => {
    expect(normalizeOjRefToResourceUri('oj:l_202401689')).toBe(
      'http://publications.europa.eu/resource/oj/L_202401689'
    )
  })

  it('ID-O3 – surrounding whitespace is trimmed', () => {
    expect(normalizeOjRefToResourceUri('  OJ:C_202400001  ')).toBe(
      'http://publications.europa.eu/resource/oj/C_202400001'
    )
  })

  it('ID-O4 – rejects references without the OJ: prefix or with unsafe chars', () => {
    expect(() => normalizeOjRefToResourceUri('L_202401689')).toThrow(/Invalid OJ reference/)
    expect(() => normalizeOjRefToResourceUri('OJ:L 202401689')).toThrow(/Invalid OJ reference/)
    expect(() => normalizeOjRefToResourceUri('OJ:L_2024/1689')).toThrow(/OJ:L_202401689/)
    expect(() => normalizeOjRefToResourceUri('')).toThrow(/Invalid OJ reference/)
  })
})
