import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock CellarClient — must be before importing the tool handler
// ---------------------------------------------------------------------------
const { mockMetadataQuery, mockResolveCelexId, mockEffectDatesQuery } = vi.hoisted(() => ({
  mockMetadataQuery: vi.fn(),
  mockResolveCelexId: vi.fn(),
  mockEffectDatesQuery: vi.fn(),
}))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: {
    metadataQuery: mockMetadataQuery,
    resolveCelexId: mockResolveCelexId,
    effectDatesQuery: mockEffectDatesQuery,
  },
}))

import { handleEurlexMetadata } from '../src/tools/metadata.js'

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  // Mirror the real resolveCelexId: celex_id passes through, eli/oj_ref would hit
  // SPARQL — individual tests override for the eli/oj_ref paths.
  mockResolveCelexId.mockImplementation(
    async (i: { celex_id?: string; eli?: string; oj_ref?: string }) =>
      i.celex_id ?? i.eli ?? i.oj_ref
  )
  mockEffectDatesQuery.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------
const mockResult = {
  celex_id: '32024R1689',
  title: 'AI Act',
  date_document: '2024-06-13',
  date_entry_into_force: '2024-08-01',
  date_application: null,
  dates_effect: [{ date: '2024-08-01', type: 'unknown', note: null }],
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

  // Note: handleEurlexMetadata no longer validates celex_id format itself —
  // the SDK validates via metadataSchema.shape before the handler ever runs
  // (see registerMetadataTool). That regex behavior is covered at the schema
  // level in metadataSchema.test.ts (M3, M8); a redundant handler-level
  // "invalid CELEX" test was removed here since it no longer exercises real
  // validation logic.

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
    expect(parsed).toHaveProperty('date_application')
    expect(parsed).toHaveProperty('dates_effect')
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
    expect(Array.isArray(parsed.dates_effect)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Task 2: eli / oj_ref identifier inputs + XOR
  // -------------------------------------------------------------------------
  it('M-ELI – resolves an eli input to a CELEX before querying metadata', async () => {
    mockResolveCelexId.mockResolvedValueOnce('32016R0679')
    mockMetadataQuery.mockResolvedValueOnce({ ...mockResult, celex_id: '32016R0679' })

    const result = await handleEurlexMetadata({
      eli: 'reg/2016/679',
      language: 'ENG',
    })

    expect(mockResolveCelexId).toHaveBeenCalledWith(
      expect.objectContaining({ eli: 'reg/2016/679' })
    )
    expect(mockMetadataQuery).toHaveBeenCalledWith('32016R0679', 'ENG')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32016R0679')
  })

  it('M-OJ – resolves an oj_ref input to a CELEX before querying metadata', async () => {
    mockResolveCelexId.mockResolvedValueOnce('32024R1689')
    mockMetadataQuery.mockResolvedValueOnce(mockResult)

    await handleEurlexMetadata({
      oj_ref: 'OJ:L_202401689',
      language: 'DEU',
    })

    expect(mockMetadataQuery).toHaveBeenCalledWith('32024R1689', 'DEU')
  })

  it('M-XOR1 – rejects when two identifiers are given at once', async () => {
    const result = await handleEurlexMetadata({
      celex_id: '32024R1689',
      oj_ref: 'OJ:L_202401689',
      language: 'DEU',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/only one identifier/i)
    expect(mockMetadataQuery).not.toHaveBeenCalled()
  })

  it('M-XOR2 – rejects when no identifier is given', async () => {
    const result = await handleEurlexMetadata({ language: 'DEU' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/exactly one identifier/i)
    expect(mockMetadataQuery).not.toHaveBeenCalled()
  })
})

describe('handleEurlexMetadata() – effect dates from the Cellar notice', () => {
  const typed = [
    { date: '2024-08-01', type: 'entry_into_force', note: 'Date pub. +20 See Art 113' },
    { date: '2026-08-02', type: 'application', note: 'See Art 113' },
  ]

  it('merges the typed dates into the result', async () => {
    mockMetadataQuery.mockResolvedValueOnce({ ...mockResult, date_entry_into_force: '2025-02-02' })
    mockEffectDatesQuery.mockResolvedValueOnce(typed)

    const result = await handleEurlexMetadata({ celex_id: '32024R1689', language: 'ENG' })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({
      date_entry_into_force: '2024-08-01',
      date_application: '2026-08-02',
      dates_effect: typed,
    })
    expect(mockEffectDatesQuery).toHaveBeenCalledWith('32024R1689')
  })

  it('runs the SPARQL query and the notice fetch in parallel', async () => {
    const order: string[] = []
    mockMetadataQuery.mockImplementationOnce(async () => {
      order.push('sparql-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('sparql-end')
      return mockResult
    })
    mockEffectDatesQuery.mockImplementationOnce(async () => {
      order.push('notice-start')
      return typed
    })

    await handleEurlexMetadata({ celex_id: '32024R1689', language: 'ENG' })

    expect(order.indexOf('notice-start')).toBeLessThan(order.indexOf('sparql-end'))
  })

  it('falls back to the SPARQL result and warns on stderr when the notice fetch fails', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockMetadataQuery.mockResolvedValueOnce(mockResult)
    mockEffectDatesQuery.mockRejectedValueOnce(new Error('Notice fetch error: 503'))

    const result = await handleEurlexMetadata({ celex_id: '32024R1689', language: 'ENG' })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({
      date_entry_into_force: '2024-08-01',
      date_application: null,
      dates_effect: [{ date: '2024-08-01', type: 'unknown', note: null }],
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('32024R1689')
    expect(String(warn.mock.calls[0][0])).toContain('Notice fetch error: 503')
    warn.mockRestore()
  })

  it('leaves the result untouched when Cellar has no notice (null)', async () => {
    mockMetadataQuery.mockResolvedValueOnce(mockResult)
    mockEffectDatesQuery.mockResolvedValueOnce(null)

    const result = await handleEurlexMetadata({ celex_id: '32024R1689', language: 'ENG' })
    expect(result.structuredContent).toEqual(mockResult)
  })
})
