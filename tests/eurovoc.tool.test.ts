import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEurovocQuery, mockResolveEurovocLabel } = vi.hoisted(() => ({
  mockEurovocQuery: vi.fn(),
  mockResolveEurovocLabel: vi.fn(),
}))
vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { eurovocQuery: mockEurovocQuery, resolveEurovocLabel: mockResolveEurovocLabel },
}))

import { handleEurlexByEurovoc } from '../src/tools/eurovoc.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleEurlexByEurovoc()', () => {
  it('E9 – returns search results as JSON (label path resolves, then queries with the URI)', async () => {
    mockResolveEurovocLabel.mockResolvedValueOnce('http://eurovoc.europa.eu/3030')
    mockEurovocQuery.mockResolvedValueOnce([
      { celex: '32024R1689', title: 'AI Act', date: '2024-06-13', type: 'REG', eurlex_url: 'https://...' },
    ])

    const result = await handleEurlexByEurovoc({
      concept: 'artificial intelligence',
      resource_type: 'any',
      language: 'ENG',
      limit: 10,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.total).toBe(1)
    expect(mockResolveEurovocLabel).toHaveBeenCalledWith('artificial intelligence', 'ENG')
    // eurovocQuery gets the already-resolved URI, not the raw label.
    expect(mockEurovocQuery).toHaveBeenCalledWith('http://eurovoc.europa.eu/3030', 'any', 'ENG', 10)
  })

  it('E9b – a EuroVoc URI concept skips label resolution entirely', async () => {
    mockEurovocQuery.mockResolvedValueOnce([
      { celex: '32024R1689', title: 'AI Act', date: '2024-06-13', type: 'REG', eurlex_url: 'https://...' },
    ])

    const result = await handleEurlexByEurovoc({
      concept: 'http://eurovoc.europa.eu/3030',
      resource_type: 'any',
      language: 'ENG',
      limit: 10,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.results).toHaveLength(1)
    expect(mockResolveEurovocLabel).not.toHaveBeenCalled()
    expect(mockEurovocQuery).toHaveBeenCalledWith('http://eurovoc.europa.eu/3030', 'any', 'ENG', 10)
  })

  it('E10 – concept resolves but matches no documents: existing "no results" message', async () => {
    mockResolveEurovocLabel.mockResolvedValueOnce('http://eurovoc.europa.eu/9999')
    mockEurovocQuery.mockResolvedValueOnce([])

    const result = await handleEurlexByEurovoc({
      concept: 'some obscure but real concept',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content[0].text).toContain('No results')
    expect(result.content[0].text).toContain('some obscure but real concept')
    expect(result.isError).toBeFalsy()
  })

  it('E10-URI – a URI concept matching no documents also gets the existing "no results" message', async () => {
    mockEurovocQuery.mockResolvedValueOnce([])

    const result = await handleEurlexByEurovoc({
      concept: 'http://eurovoc.europa.eu/9999',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content[0].text).toContain('No results')
    expect(result.isError).toBeFalsy()
  })

  it('E10-FALLBACK – label unresolved after both attempts: explains the 24-language fallback was tried, no doc query is made', async () => {
    mockResolveEurovocLabel.mockResolvedValueOnce(null)

    const result = await handleEurlexByEurovoc({
      concept: 'xyznonexistent',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content[0].text).toContain('xyznonexistent')
    expect(result.content[0].text).toContain('24')
    expect(result.content[0].text.toLowerCase()).toContain('language')
    expect(result.isError).toBeFalsy()
    // No concept was resolved — querying documents would be pointless.
    expect(mockEurovocQuery).not.toHaveBeenCalled()
  })

  it('E11 – returns isError on failure (document query)', async () => {
    mockResolveEurovocLabel.mockResolvedValueOnce('http://eurovoc.europa.eu/1234')
    mockEurovocQuery.mockRejectedValueOnce(new Error('timeout'))

    const result = await handleEurlexByEurovoc({
      concept: 'test',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.isError).toBe(true)
  })

  it('E11b – returns isError on failure (label resolution)', async () => {
    mockResolveEurovocLabel.mockRejectedValueOnce(new Error('SPARQL query timed out'))

    const result = await handleEurlexByEurovoc({
      concept: 'test',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.isError).toBe(true)
    expect(mockEurovocQuery).not.toHaveBeenCalled()
  })
})
