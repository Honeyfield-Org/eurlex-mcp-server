import { describe, it, expect } from 'vitest'
import { selectEntryIntoForce, mergeEffectDates } from '../src/services/effectDates.js'
import type { MetadataResult } from '../src/types.js'

describe('selectEntryIntoForce()', () => {
  it('returns null for an empty list', () => {
    expect(selectEntryIntoForce([], '2016-04-27')).toBeNull()
  })

  it('returns the single date when only one exists', () => {
    expect(selectEntryIntoForce(['2023-01-16'], '2022-12-14')).toBe('2023-01-16')
  })

  it('picks the earliest date that is not before the document date (GDPR)', () => {
    // 2016-05-24 = entry into force, 2018-05-25 = application
    expect(selectEntryIntoForce(['2018-05-25', '2016-05-24'], '2016-04-27')).toBe('2016-05-24')
  })

  it('skips dates before the document date (DSA data error 2022-02-17)', () => {
    expect(selectEntryIntoForce(['2022-02-17', '2022-11-16'], '2022-10-19')).toBe('2022-11-16')
  })

  it('falls back to the earliest date when every date is before the document date', () => {
    expect(selectEntryIntoForce(['2020-01-01', '2021-01-01'], '2022-01-01')).toBe('2020-01-01')
  })

  it('uses the earliest date when the document date is unknown', () => {
    expect(selectEntryIntoForce(['2025-02-02', '2024-08-01'], null)).toBe('2024-08-01')
  })

  it('does not mutate the input array', () => {
    const input = ['2018-05-25', '2016-05-24']
    selectEntryIntoForce(input, null)
    expect(input).toEqual(['2018-05-25', '2016-05-24'])
  })
})

const base: MetadataResult = {
  celex_id: '32016R0679',
  title: 'GDPR',
  date_document: '2016-04-27',
  date_entry_into_force: '2016-05-24',
  date_application: null,
  dates_effect: [
    { date: '2016-05-24', type: 'unknown', note: null },
    { date: '2018-05-25', type: 'unknown', note: null },
  ],
  date_end_of_validity: null,
  in_force: true,
  date_transposition: null,
  resource_type: 'REG',
  authors: ['European Parliament'],
  eurovoc_concepts: ['data protection'],
  directory_codes: [],
  legal_basis: [],
  eurlex_url: 'https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX:32016R0679',
}

describe('mergeEffectDates()', () => {
  it('returns the base result unchanged (same reference) when the notice is unavailable', () => {
    expect(mergeEffectDates(base, null)).toBe(base)
    expect(mergeEffectDates(base, [])).toBe(base)
  })

  it('takes entry into force from the EV entry and application from the MA entry', () => {
    const merged = mergeEffectDates(base, [
      { date: '2016-05-24', type: 'entry_into_force', note: 'Date pub. +20 See Art 99' },
      { date: '2018-05-25', type: 'application', note: 'See Art 99' },
    ])
    expect(merged.date_entry_into_force).toBe('2016-05-24')
    expect(merged.date_application).toBe('2018-05-25')
    expect(merged.dates_effect).toHaveLength(2)
    expect(merged.dates_effect[1]).toEqual({ date: '2018-05-25', type: 'application', note: 'See Art 99' })
    // untouched fields are carried over
    expect(merged.title).toBe('GDPR')
    expect(merged.authors).toEqual(['European Parliament'])
  })

  it('prefers the EV entry over the heuristic even when it is later (DSA)', () => {
    const dsaBase: MetadataResult = { ...base, date_document: '2022-10-19', date_entry_into_force: '2022-02-17' }
    const merged = mergeEffectDates(dsaBase, [
      { date: '2022-02-17', type: 'application', note: 'See Art 93.2' },
      { date: '2022-11-16', type: 'entry_into_force', note: 'Date pub. +20 See Art 93.1' },
      { date: '2022-11-16', type: 'partial_application', note: 'Partial application See Art 93.2' },
    ])
    expect(merged.date_entry_into_force).toBe('2022-11-16')
    expect(merged.date_application).toBe('2022-02-17')
  })

  it('ignores partial application dates for date_application (AI Act)', () => {
    const merged = mergeEffectDates(base, [
      { date: '2024-08-01', type: 'entry_into_force', note: 'Date pub. +20 See Art 113' },
      { date: '2025-02-02', type: 'partial_application', note: 'Partial application See Art 113(a)' },
      { date: '2026-08-02', type: 'application', note: 'See Art 113' },
      { date: '2027-08-02', type: 'partial_application', note: 'Partial application See Art 113(c)' },
    ])
    expect(merged.date_entry_into_force).toBe('2024-08-01')
    expect(merged.date_application).toBe('2026-08-02')
  })

  it('keeps the heuristic entry-into-force date when the notice has no EV entry', () => {
    const merged = mergeEffectDates(base, [{ date: '2018-05-25', type: 'application', note: null }])
    expect(merged.date_entry_into_force).toBe('2016-05-24')
    expect(merged.date_application).toBe('2018-05-25')
  })

  it('does not mutate the base result', () => {
    const snapshot = JSON.stringify(base)
    mergeEffectDates(base, [{ date: '2016-05-24', type: 'entry_into_force', note: null }])
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})
