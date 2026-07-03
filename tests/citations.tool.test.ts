import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCitationsQuery = vi.fn()
vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn().mockImplementation(() => ({
    citationsQuery: mockCitationsQuery,
  })),
}))

import { handleEurlexCitations } from '../src/tools/citations.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleEurlexCitations()', () => {
  it('C11 – returns citations as JSON in MCP format', async () => {
    mockCitationsQuery.mockResolvedValueOnce({
      celex_id: '32024R1689',
      citations: [{ celex: '32016R0679', title: 'DSGVO', relationship: 'cites' }],
      total: 1,
    })

    const result = await handleEurlexCitations({
      celex_id: '32024R1689',
      language: 'DEU',
      direction: 'both',
      limit: 20,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32024R1689')
    expect(parsed.citations).toHaveLength(1)
  })

  it('C12 – returns informative message when no citations found', async () => {
    mockCitationsQuery.mockResolvedValueOnce({
      celex_id: '99999X9999',
      citations: [],
      total: 0,
    })

    const result = await handleEurlexCitations({
      celex_id: '99999X9999',
      language: 'DEU',
      direction: 'both',
      limit: 20,
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('No citations found')
    expect(result.content[0].text).toContain('99999X9999')
  })

  it('C13 – returns isError on failure', async () => {
    mockCitationsQuery.mockRejectedValueOnce(new Error('SPARQL timeout'))

    const result = await handleEurlexCitations({
      celex_id: '32024R1689',
      language: 'DEU',
      direction: 'both',
      limit: 20,
    })

    expect(result.isError).toBe(true)
  })
})
