import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock CellarClient — must be before importing the tool handler
// ---------------------------------------------------------------------------
const mockMetadataQuery = vi.fn()

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn().mockImplementation(() => ({
    metadataQuery: mockMetadataQuery,
  })),
}))

import { handleEurlexMetadata } from '../src/tools/metadata.js'

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------
const mockResult = {
  celex_id: '32024R1689',
  title: 'AI Act',
  date_document: '2024-06-13',
  date_entry_into_force: '2024-08-01',
  date_end_of_validity: null,
  in_force: true,
  date_transposition: null,
  resource_type: 'REG',
  authors: ['European Parliament', 'Council of the European Union'],
  eurovoc_concepts: ['artificial intelligence', 'high risk'],
  directory_codes: ['163010: Information technology'],
  legal_basis: ['12016E114'],
  eurlex_url: 'https://eur-lex.europa.eu/legal-content/de/TXT/?uri=CELEX:32024R1689',
}

// ===========================================================================
// Tests: handleEurlexMetadata tool handler
// ===========================================================================
describe('handleEurlexMetadata()', () => {
  it('M9 – returns metadata JSON on success', async () => {
    mockMetadataQuery.mockResolvedValueOnce(mockResult)

    const result = await handleEurlexMetadata({
      celex_id: '32024R1689',
      language: 'DEU',
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result).not.toHaveProperty('isError')

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32024R1689')
    expect(parsed.title).toBe('AI Act')
  })

  it('M10 – returns isError on CellarClient error', async () => {
    mockMetadataQuery.mockRejectedValueOnce(new Error('SPARQL endpoint unavailable'))

    const result = await handleEurlexMetadata({
      celex_id: '32024R1689',
      language: 'DEU',
    })

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('SPARQL endpoint unavailable')
  })

  it('M10b – returns isError on invalid CELEX ID', async () => {
    const result = await handleEurlexMetadata({
      celex_id: 'INVALID!!!',
      language: 'DEU',
    })

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toMatch(/Error:/)
  })

  it('M10c – returned JSON contains all MetadataResult fields', async () => {
    mockMetadataQuery.mockResolvedValueOnce(mockResult)

    const result = await handleEurlexMetadata({
      celex_id: '32024R1689',
      language: 'DEU',
    })

    expect(result).not.toHaveProperty('isError')

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveProperty('celex_id')
    expect(parsed).toHaveProperty('title')
    expect(parsed).toHaveProperty('date_document')
    expect(parsed).toHaveProperty('date_entry_into_force')
    expect(parsed).toHaveProperty('date_end_of_validity')
    expect(parsed).toHaveProperty('in_force')
    expect(parsed).toHaveProperty('date_transposition')
    expect(parsed).toHaveProperty('resource_type')
    expect(parsed).toHaveProperty('authors')
    expect(parsed).toHaveProperty('eurovoc_concepts')
    expect(parsed).toHaveProperty('directory_codes')
    expect(parsed).toHaveProperty('legal_basis')
    expect(parsed).toHaveProperty('eurlex_url')

    expect(Array.isArray(parsed.authors)).toBe(true)
    expect(Array.isArray(parsed.eurovoc_concepts)).toBe(true)
    expect(Array.isArray(parsed.directory_codes)).toBe(true)
    expect(Array.isArray(parsed.legal_basis)).toBe(true)
  })
})
