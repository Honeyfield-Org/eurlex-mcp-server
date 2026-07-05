import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TranspositionResult } from '../src/types.js'

const { mockTranspositionQuery } = vi.hoisted(() => ({ mockTranspositionQuery: vi.fn() }))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { transpositionQuery: mockTranspositionQuery },
}))

import { handleEurlexTransposition } from '../src/tools/transposition.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const baseInput = { celex_id: '32022L2555', language: 'DEU', limit: 20 }

describe('handleEurlexTransposition()', () => {
  it('TT1 – successful lookup returns JSON results and forwards all fields', async () => {
    const mockResult: TranspositionResult = {
      celex_id: '32022L2555',
      results: [
        {
          country: 'AT',
          title: 'NIS-Gesetz',
          date: '2025-01-02',
          celex: '72022L2555AUT_202500243',
          eurlex_url: 'https://eur-lex.europa.eu/legal-content/de/TXT/?uri=CELEX:72022L2555AUT_202500243',
        },
      ],
      returned: 1,
      total_found: 8,
    }
    mockTranspositionQuery.mockResolvedValueOnce(mockResult)

    const result = await handleEurlexTransposition({ ...baseInput, country: 'AT' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('72022L2555AUT_202500243')
    expect(result.content[0].text).toContain('"total_found":8')
    expect(mockTranspositionQuery).toHaveBeenCalledWith(
      expect.objectContaining({ celex_id: '32022L2555', country: 'AT', language: 'DEU', limit: 20 }),
    )
  })

  it('TT2 – no results returns a helpful message, not an error', async () => {
    mockTranspositionQuery.mockResolvedValueOnce({
      celex_id: '32016R0679',
      results: [],
      returned: 0,
      total_found: 0,
    })

    const result = await handleEurlexTransposition({ ...baseInput, celex_id: '32016R0679' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('No national implementing measures found')
  })

  it('TT3 – the no-results message names the country filter when present', async () => {
    mockTranspositionQuery.mockResolvedValueOnce({
      celex_id: '32022L2555',
      results: [],
      returned: 0,
      total_found: 0,
    })

    const result = await handleEurlexTransposition({ ...baseInput, country: 'MT' })

    expect(result.content[0].text).toContain('in MT')
  })

  it('TT4 – client error is surfaced as a structured error', async () => {
    mockTranspositionQuery.mockRejectedValueOnce(new Error('SPARQL endpoint error: 503'))

    const result = await handleEurlexTransposition({ ...baseInput })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Error')
  })

  it('TT5 – country is optional (undefined forwarded)', async () => {
    mockTranspositionQuery.mockResolvedValueOnce({
      celex_id: '32022L2555',
      results: [],
      returned: 0,
      total_found: 0,
    })

    await handleEurlexTransposition({ ...baseInput })

    expect(mockTranspositionQuery).toHaveBeenCalledWith(
      expect.objectContaining({ celex_id: '32022L2555', country: undefined }),
    )
  })
})
