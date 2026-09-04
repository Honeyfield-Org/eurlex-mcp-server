import { describe, it, expect } from 'vitest'
import { selectEntryIntoForce } from '../src/services/effectDates.js'

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
