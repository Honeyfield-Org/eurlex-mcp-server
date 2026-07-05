import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SummaryMeta } from '../src/types.js'

const { mockFindSummaries, mockFetchSummaryDocument } = vi.hoisted(() => ({
  mockFindSummaries: vi.fn(),
  mockFetchSummaryDocument: vi.fn(),
}))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: {
    findSummaries: mockFindSummaries,
    fetchSummaryDocument: mockFetchSummaryDocument,
  },
}))

import { handleEurlexSummary, selectPrimarySummary } from '../src/tools/summary.js'
import type { SummaryResult } from '../src/types.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const baseInput = { celex_id: '32016R0679', language: 'ENG', max_chars: 20000, offset: 0 }

function meta(overrides: Partial<SummaryMeta> = {}): SummaryMeta {
  return {
    uri: 'http://publications.europa.eu/resource/cellar/primary',
    legissum_id: '310401_2',
    title: 'General data protection regulation (GDPR)',
    date: '2026-03-24',
    obsolete: false,
    ...overrides,
  }
}

describe('selectPrimarySummary()', () => {
  it('SP1 – returns null for an empty list', () => {
    expect(selectPrimarySummary([])).toBeNull()
  })

  it('SP2 – prefers a non-obsolete summary over a newer obsolete one', () => {
    const chosen = selectPrimarySummary([
      meta({ uri: 'a', obsolete: true, date: '2030-01-01' }),
      meta({ uri: 'b', obsolete: false, date: '2010-01-01' }),
    ])
    expect(chosen?.uri).toBe('b')
  })

  it('SP3 – among non-obsolete, prefers the newest date', () => {
    const chosen = selectPrimarySummary([
      meta({ uri: 'old', obsolete: false, date: '2019-01-01' }),
      meta({ uri: 'new', obsolete: false, date: '2024-01-01' }),
    ])
    expect(chosen?.uri).toBe('new')
  })

  it('SP4 – tie-breaks equal dates by highest legissum_id (deterministic)', () => {
    const chosen = selectPrimarySummary([
      meta({ uri: 'lo', legissum_id: '100', date: '2024-01-01' }),
      meta({ uri: 'hi', legissum_id: '900', date: '2024-01-01' }),
    ])
    expect(chosen?.uri).toBe('hi')
  })

  it('SP5 – a summary with a real date outranks one with an empty date', () => {
    const chosen = selectPrimarySummary([
      meta({ uri: 'nodate', date: '' }),
      meta({ uri: 'dated', date: '2000-01-01' }),
    ])
    expect(chosen?.uri).toBe('dated')
  })
})

describe('handleEurlexSummary()', () => {
  it('HS1 – no summary returns a helpful message, not an error', async () => {
    mockFindSummaries.mockResolvedValueOnce([])

    const result = await handleEurlexSummary({ ...baseInput, celex_id: '32024R9999' })

    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('No LEGISSUM summary')
    expect(mockFetchSummaryDocument).not.toHaveBeenCalled()
  })

  it('HS2 – a single summary returns processed plain text plus metadata and source_url', async () => {
    mockFindSummaries.mockResolvedValueOnce([meta()])
    mockFetchSummaryDocument.mockResolvedValueOnce(
      '<html><body><h1>General data protection regulation (GDPR)</h1><p>SUMMARY OF: Regulation (EU) 2016/679.</p></body></html>',
    )

    const result = await handleEurlexSummary(baseInput)
    expect(result.isError).toBeFalsy()

    const out = JSON.parse(result.content[0].text) as SummaryResult
    expect(out.celex_id).toBe('32016R0679')
    expect(out.legissum_id).toBe('310401_2')
    expect(out.title).toContain('General data protection regulation')
    expect(out.obsolete).toBe(false)
    expect(out.content).toContain('SUMMARY OF')
    expect(out.content).not.toContain('<p>') // HTML stripped
    expect(out.total_summaries).toBe(1)
    expect(out.other_summaries).toBeUndefined()
    // Source URL is the human EUR-Lex LSU (legislative summary) page in the requested locale.
    expect(out.source_url).toBe(
      'https://eur-lex.europa.eu/legal-content/en/LSU/?uri=CELEX:32016R0679',
    )
    // The primary summary's URI (not the CELEX) drives the content fetch.
    expect(mockFetchSummaryDocument).toHaveBeenCalledWith(
      'http://publications.europa.eu/resource/cellar/primary',
      'ENG',
    )
  })

  it('HS3 – fetches the SELECTED primary summary when several exist, and lists the others', async () => {
    mockFindSummaries.mockResolvedValueOnce([
      meta({ uri: 'obsolete-old', legissum_id: '111', date: '2015-01-01', obsolete: true }),
      meta({ uri: 'current', legissum_id: '222', date: '2024-01-01', obsolete: false }),
    ])
    mockFetchSummaryDocument.mockResolvedValueOnce('<p>current summary text</p>')

    const result = await handleEurlexSummary(baseInput)
    const out = JSON.parse(result.content[0].text) as SummaryResult

    expect(mockFetchSummaryDocument).toHaveBeenCalledWith('current', 'ENG')
    expect(out.legissum_id).toBe('222')
    expect(out.total_summaries).toBe(2)
    expect(out.other_summaries).toHaveLength(1)
    expect(out.other_summaries?.[0].legissum_id).toBe('111')
    expect(out.other_summaries?.[0].obsolete).toBe(true)
  })

  it('HS4 – pagination: offset/max_chars flow through processContent to next_offset', async () => {
    mockFindSummaries.mockResolvedValueOnce([meta()])
    // 30 chars of plain text after stripping.
    mockFetchSummaryDocument.mockResolvedValueOnce('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')

    const result = await handleEurlexSummary({ ...baseInput, max_chars: 10, offset: 0 })
    const out = JSON.parse(result.content[0].text) as SummaryResult

    expect(out.returned_chars).toBe(10)
    expect(out.truncated).toBe(true)
    expect(out.next_offset).toBe(10)
    expect(out.offset).toBe(0)
  })

  it('HS5 – a client error is surfaced as a structured error', async () => {
    mockFindSummaries.mockRejectedValueOnce(new Error('SPARQL endpoint error: 503'))

    const result = await handleEurlexSummary(baseInput)

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Error')
  })
})
