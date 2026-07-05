import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CaseLawResult } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock CellarClient — must be before importing the tool handler
// ---------------------------------------------------------------------------
const { mockCaseLawQuery } = vi.hoisted(() => ({ mockCaseLawQuery: vi.fn() }))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { caseLawQuery: mockCaseLawQuery },
}))

import { handleEurlexCaseLaw } from '../src/tools/caseLaw.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const baseInput = {
  court: 'any',
  type: 'any',
  language: 'DEU',
  limit: 10,
}

describe('handleEurlexCaseLaw()', () => {
  it('CLT1 – successful lookup returns JSON results', async () => {
    const mockResult: CaseLawResult = {
      results: [
        {
          celex: '62012CJ0131',
          ecli: 'ECLI:EU:C:2014:317',
          title: 'Google Spain',
          date: '2014-05-13',
          type: 'JUDG',
          eurlex_url: 'https://eur-lex.europa.eu/legal-content/de/TXT/?uri=CELEX:62012CJ0131',
        },
      ],
      total: 1,
    }
    mockCaseLawQuery.mockResolvedValueOnce(mockResult)

    const result = await handleEurlexCaseLaw({ ...baseInput, ecli: 'ECLI:EU:C:2014:317' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('62012CJ0131')
    expect(result.content[0].text).toContain('ECLI:EU:C:2014:317')
    // Handler forwarded all fields to the client.
    expect(mockCaseLawQuery).toHaveBeenCalledWith(
      expect.objectContaining({ ecli: 'ECLI:EU:C:2014:317', court: 'any', type: 'any' }),
    )
  })

  it('CLT2 – no results returns a helpful message, not an error', async () => {
    mockCaseLawQuery.mockResolvedValueOnce({ results: [], total: 0 })

    const result = await handleEurlexCaseLaw({ ...baseInput, query: 'zzznope' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('No case law found')
  })

  it('CLT3 – enforces the at-least-one rule (no primary input)', async () => {
    const result = await handleEurlexCaseLaw({ ...baseInput })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/at least one search input/i)
    expect(mockCaseLawQuery).not.toHaveBeenCalled()
  })

  it('CLT4 – client error is surfaced as a structured error', async () => {
    mockCaseLawQuery.mockRejectedValueOnce(new Error('SPARQL endpoint error: 503'))

    const result = await handleEurlexCaseLaw({ ...baseInput, query: 'Schrems' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Error')
  })

  it('CLT5 – forwards related_celex + filters to the client', async () => {
    mockCaseLawQuery.mockResolvedValueOnce({ results: [], total: 0 })

    await handleEurlexCaseLaw({
      ...baseInput,
      related_celex: '32016R0679',
      court: 'COURT_JUSTICE',
      type: 'JUDG',
      language: 'ENG',
      date_from: '2020-01-01',
    })

    expect(mockCaseLawQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        related_celex: '32016R0679',
        court: 'COURT_JUSTICE',
        type: 'JUDG',
        language: 'ENG',
        date_from: '2020-01-01',
      }),
    )
  })
})
