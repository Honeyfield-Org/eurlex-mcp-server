import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SearchResult } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock CellarClient — must be before importing the tool handler
// ---------------------------------------------------------------------------
const mockSparqlQuery = vi.fn()

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn().mockImplementation(() => ({
    sparqlQuery: mockSparqlQuery,
  })),
}))

import { handleEurlexSearch } from '../src/tools/search.js'

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// Tests T15-T17: handleEurlexSearch tool handler
// ===========================================================================
describe('handleEurlexSearch()', () => {
  it('T15 – successful search returns formatted results', async () => {
    const mockResult: SearchResult = {
      celex: '32024R1689',
      title: 'KI-Verordnung',
      date: '2024-07-12',
      type: 'REG',
      eurlex_url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:32024R1689',
    }

    mockSparqlQuery.mockResolvedValueOnce({ results: [mockResult], sparql: 'SELECT ...' })

    const result = await handleEurlexSearch({
      query: 'artificial intelligence',
      resource_type: 'REG',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('32024R1689')
    expect(result.content[0].text).toContain('KI-Verordnung')
    expect(result.isError).toBeFalsy()
  })

  it('T16 – no results returns helpful message', async () => {
    mockSparqlQuery.mockResolvedValueOnce({ results: [], sparql: 'SELECT ...' })

    const result = await handleEurlexSearch({
      query: 'xyznotfound',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('No results')
    expect(result.isError).toBeFalsy()
  })

  it('T-NOECHO – response does not echo the SPARQL query (query_used dropped)', async () => {
    mockSparqlQuery.mockResolvedValueOnce({
      results: [{ celex: '32024R1689', title: 'AI Act', date: '2024-07-12', type: 'REG', eurlex_url: 'https://example.com' }],
      sparql: 'SELECT DISTINCT ?work ...',
    })
    const result = await handleEurlexSearch({
      query: 'artificial intelligence',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).not.toHaveProperty('query_used')
    expect(result.content[0].text).not.toContain('SELECT DISTINCT ?work')
  })

  it('T17 – API error returns structured error', async () => {
    mockSparqlQuery.mockRejectedValueOnce(new Error('SPARQL endpoint error: 503'))

    const result = await handleEurlexSearch({
      query: 'artificial intelligence',
      resource_type: 'REG',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('Error')
    expect(result.isError).toBe(true)
  })
})
