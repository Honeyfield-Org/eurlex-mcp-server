import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEurovocQuery } = vi.hoisted(() => ({ mockEurovocQuery: vi.fn() }))
vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { eurovocQuery: mockEurovocQuery },
}))

import { handleEurlexByEurovoc } from '../src/tools/eurovoc.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleEurlexByEurovoc()', () => {
  it('E9 – returns search results as JSON', async () => {
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
  })

  it('E10 – returns no-results message when empty', async () => {
    mockEurovocQuery.mockResolvedValueOnce([])

    const result = await handleEurlexByEurovoc({
      concept: 'xyznonexistent',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.content[0].text).toContain('No results')
  })

  it('E11 – returns isError on failure', async () => {
    mockEurovocQuery.mockRejectedValueOnce(new Error('timeout'))

    const result = await handleEurlexByEurovoc({
      concept: 'test',
      resource_type: 'any',
      language: 'DEU',
      limit: 10,
    })

    expect(result.isError).toBe(true)
  })
})
