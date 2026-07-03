import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFetchConsolidated } = vi.hoisted(() => ({ mockFetchConsolidated: vi.fn() }))
vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { fetchConsolidated: mockFetchConsolidated },
}))

import { handleEurlexConsolidated } from '../src/tools/consolidated.js'
import type { ConsolidatedResult } from '../src/types.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const mockResult = (
  content: string,
  eliUrl = 'http://data.europa.eu/eli/reg/2024/1689/deu/xhtml',
  consolidatedCelex = '02024R1689-20240712',
) => ({ content, eliUrl, consolidatedCelex })

describe('handleEurlexConsolidated()', () => {
  it('CO7 – returns document content with truncation info', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('<html><body>Content</body></html>'))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).toContain('Content')
    expect(parsed.truncated).toBe(false)
    expect(parsed.eli_url).toContain('data.europa.eu/eli/reg/2024/1689')
    expect(parsed.eli_url).not.toContain('/oj/')
    expect(parsed.eli_url).toContain('/deu/xhtml')
  })

  it('CO8b – plain format strips script and style tags completely', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(
      mockResult('<html><script>if (a > b) { alert("x") }</script><p>Hello</p><style>.foo > .bar { color: red }</style></html>')
    )
    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'plain',
      max_chars: 20000,
      offset: 0,
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).not.toContain('alert')
    expect(parsed.content).not.toContain('color')
    expect(parsed.content).toContain('Hello')
  })

  it('CO8 – strips HTML in plain format', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('<html><body><p>Text</p></body></html>'))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'plain',
      max_chars: 20000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).not.toContain('<')
    expect(parsed.content).toContain('Text')
  })

  it('CO9b – total_chars reports original length when truncated', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('x'.repeat(5000)))
    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 1000,
      offset: 0,
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.truncated).toBe(true)
    expect(parsed.total_chars).toBe(5000)
    expect(parsed.returned_chars).toBe(1000)
    expect(parsed.next_offset).toBe(1000)
  })

  it('CO9 – truncates at max_chars', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('x'.repeat(30000)))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 5000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.truncated).toBe(true)
    expect(parsed.total_chars).toBe(30000)
  })

  it('CO11 – offset paginates into the middle of the document', async () => {
    // Schema requires max_chars >= 1000, so use a document long enough to
    // exercise a genuine middle window.
    const doc = '0123456789'.repeat(300) // 3000 chars
    mockFetchConsolidated.mockResolvedValueOnce(mockResult(doc))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 1000,
      offset: 1000,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).toBe(doc.slice(1000, 2000))
    expect(parsed.offset).toBe(1000)
    expect(parsed.returned_chars).toBe(1000)
    expect(parsed.truncated).toBe(true)
    expect(parsed.next_offset).toBe(2000)
  })

  it('CO12 – consolidated_celex and consolidation_date are derived from the resolved CELEX (with -YYYYMMDD suffix)', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(
      mockResult('<p>Content</p>', undefined, '02016R0679-20160504'),
    )

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2016,
      number: 679,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.consolidated_celex).toBe('02016R0679-20160504')
    expect(parsed.consolidation_date).toBe('2016-05-04')
  })

  it('CO13 – consolidation_date is null when the resolved CELEX has no -YYYYMMDD suffix', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(
      mockResult('<p>Content</p>', undefined, '02016R0679'),
    )

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2016,
      number: 679,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.consolidated_celex).toBe('02016R0679')
    expect(parsed.consolidation_date).toBeNull()
  })

  it('CO-TYPE – result satisfies ConsolidatedResult shape', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('<html><body>Content</body></html>'))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed: ConsolidatedResult = JSON.parse(result.content[0].text)
    const requiredKeys: (keyof ConsolidatedResult)[] = [
      'doc_type',
      'year',
      'number',
      'language',
      'content',
      'truncated',
      'returned_chars',
      'total_chars',
      'offset',
      'next_offset',
      'eli_url',
      'consolidated_celex',
      'consolidation_date',
    ]
    for (const key of requiredKeys) {
      expect(parsed).toHaveProperty(key)
    }
    expect(parsed).not.toHaveProperty('char_count')
    expect(typeof parsed.doc_type).toBe('string')
    expect(typeof parsed.year).toBe('number')
    expect(typeof parsed.number).toBe('number')
    expect(typeof parsed.language).toBe('string')
    expect(typeof parsed.content).toBe('string')
    expect(typeof parsed.truncated).toBe('boolean')
    expect(typeof parsed.returned_chars).toBe('number')
    expect(typeof parsed.total_chars).toBe('number')
    expect(typeof parsed.offset).toBe('number')
    expect(typeof parsed.eli_url).toBe('string')
    expect(typeof parsed.consolidated_celex).toBe('string')
  })

  it('CO10 – returns isError on failure', async () => {
    // year/number must be within schema bounds so the request actually
    // reaches CellarClient.fetchConsolidated() and exercises its rejection
    // (a previously out-of-range year here silently short-circuited on Zod
    // validation before ever calling the mock, leaving the queued rejection
    // unconsumed and leaking into whichever test ran next).
    mockFetchConsolidated.mockRejectedValueOnce(new Error('Not found'))

    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      year: 2024,
      number: 9999,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(mockFetchConsolidated).toHaveBeenCalledWith('reg', 2024, 9999, 'DEU')
  })

  it('CO-SCHEMA – rejects unknown doc_type via Zod schema validation', async () => {
    const result = await handleEurlexConsolidated({
      doc_type: 'unknown',
      year: 2024,
      number: 1689,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Error:/)
  })
})

// ===========================================================================
// Tests: celex_id input (Task 5) — XOR enforcement + CELEX derivation
// ===========================================================================
describe('handleEurlexConsolidated() — celex_id input', () => {
  it('CO-CX1 – derives doc_type=reg/year/number from a sector-3 "R" CELEX and calls fetchConsolidated with them', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(
      mockResult('<p>GDPR</p>', undefined, '02016R0679-20160504'),
    )

    const result = await handleEurlexConsolidated({
      celex_id: '32016R0679',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(mockFetchConsolidated).toHaveBeenCalledWith('reg', 2016, 679, 'DEU')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.doc_type).toBe('reg')
    expect(parsed.year).toBe(2016)
    expect(parsed.number).toBe(679)
  })

  it('CO-CX2 – derives doc_type=dir from an "L" CELEX', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('<p>NIS2</p>'))

    await handleEurlexConsolidated({
      celex_id: '32022L2555',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(mockFetchConsolidated).toHaveBeenCalledWith('dir', 2022, 2555, 'DEU')
  })

  it('CO-CX3 – derives doc_type=dec from a "D" CELEX', async () => {
    mockFetchConsolidated.mockResolvedValueOnce(mockResult('<p>Decision</p>'))

    await handleEurlexConsolidated({
      celex_id: '32020D1234',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(mockFetchConsolidated).toHaveBeenCalledWith('dec', 2020, 1234, 'DEU')
  })

  it('CO-CX4 – rejects a non-sector-3 CELEX with a clear error, without calling fetchConsolidated', async () => {
    const result = await handleEurlexConsolidated({
      celex_id: '62018CJ0311',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/sector-3/)
    expect(mockFetchConsolidated).not.toHaveBeenCalled()
  })

  it('CO-CX5 – rejects a sector-3 CELEX with a type letter outside R/L/D', async () => {
    const result = await handleEurlexConsolidated({
      celex_id: '32016X0679',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/sector-3/)
    expect(mockFetchConsolidated).not.toHaveBeenCalled()
  })

  it('CO-CX6 – rejects when both celex_id and doc_type+year+number are provided', async () => {
    const result = await handleEurlexConsolidated({
      celex_id: '32016R0679',
      doc_type: 'reg',
      year: 2016,
      number: 679,
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(mockFetchConsolidated).not.toHaveBeenCalled()
  })

  it('CO-CX7 – rejects when neither celex_id nor doc_type+year+number are provided', async () => {
    const result = await handleEurlexConsolidated({
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(mockFetchConsolidated).not.toHaveBeenCalled()
  })

  it('CO-CX8 – rejects a partial triple (doc_type only, no celex_id)', async () => {
    const result = await handleEurlexConsolidated({
      doc_type: 'reg',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(mockFetchConsolidated).not.toHaveBeenCalled()
  })
})
