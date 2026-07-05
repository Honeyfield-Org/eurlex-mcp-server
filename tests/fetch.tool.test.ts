import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock CellarClient — must be before importing the tool handler
// ---------------------------------------------------------------------------
const { mockFetchDocument, mockResolveCelexId } = vi.hoisted(() => ({
  mockFetchDocument: vi.fn(),
  mockResolveCelexId: vi.fn(),
}))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: {
    fetchDocument: mockFetchDocument,
    // Default: behave like the real dispatch for a celex_id (verbatim), so the
    // existing celex_id-based tests need no per-test setup. eli/oj_ref tests
    // override this to a resolved CELEX.
    resolveCelexId: mockResolveCelexId,
  },
}))

import { CELLAR_REST_BASE } from '../src/constants.js'
import { handleEurlexFetch } from '../src/tools/fetch.js'
import type { FetchResult } from '../src/types.js'

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
})

// ===========================================================================
// Tests: handleEurlexFetch tool handler
// ===========================================================================
describe('handleEurlexFetch()', () => {
  it('T18 – returns document content successfully (happy path)', async () => {
    mockFetchDocument.mockResolvedValueOnce('<div><p>Artikel 1</p></div>')

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result).not.toHaveProperty('isError')

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32024R1689')
    expect(parsed.content).toContain('Artikel 1')
  })

  it('T18b – content truncated when exceeding max_chars', async () => {
    mockFetchDocument.mockResolvedValueOnce('x'.repeat(25000))

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.truncated).toBe(true)
    expect(parsed.content.length).toBeLessThanOrEqual(20000)
  })

  it('T19 – returns isError: true when fetchDocument throws', async () => {
    mockFetchDocument.mockRejectedValueOnce(new Error('Document not found'))

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('Document not found')
  })

  // Note: handleEurlexFetch no longer validates celex_id format itself — the
  // SDK validates via fetchSchema.shape before the handler ever runs (see
  // registerFetchTool). That regex behavior is covered at the schema level in
  // fetchSchema.test.ts (F3, F4); a redundant handler-level "invalid CELEX"
  // test was removed here since it no longer exercises real validation logic.

  it('T18c – total_chars reports original length when truncated', async () => {
    const longContent = 'x'.repeat(5000)
    mockFetchDocument.mockResolvedValueOnce(longContent)
    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
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

  it('T20b – plain format strips script and style tags completely', async () => {
    mockFetchDocument.mockResolvedValueOnce(
      '<html><script>if (a > b) { alert("x") }</script><p>Hello</p><style>.foo > .bar { color: red }</style></html>'
    )
    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
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

  it('T20 – plain format removes XHTML tags', async () => {
    mockFetchDocument.mockResolvedValueOnce(
      '<div><p>Artikel 1: Gegenstand</p></div>'
    )

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'plain',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).not.toContain('<div>')
    expect(parsed.content).toContain('Artikel 1')
  })

  it('T21 – offset paginates into the middle of the document', async () => {
    // Schema requires max_chars >= 1000, so use a document long enough to
    // exercise a genuine middle window.
    const doc = '0123456789'.repeat(300) // 3000 chars
    mockFetchDocument.mockResolvedValueOnce(doc)

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 1000,
      offset: 1000,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).toBe(doc.slice(1000, 2000))
    expect(parsed.offset).toBe(1000)
    expect(parsed.returned_chars).toBe(1000)
    expect(parsed.total_chars).toBe(3000)
    expect(parsed.truncated).toBe(true)
    expect(parsed.next_offset).toBe(2000)
  })

  it('T22 – offset 0 then offset next_offset concatenate to the full processed text', async () => {
    const full = 'The quick brown fox jumps over the lazy dog. '.repeat(60) // ~2760 chars
    mockFetchDocument.mockResolvedValueOnce(full).mockResolvedValueOnce(full)

    const first = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 1000,
      offset: 0,
    })
    const firstParsed = JSON.parse(first.content[0].text)
    expect(firstParsed.truncated).toBe(true)

    const second = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: firstParsed.next_offset,
    })
    const secondParsed = JSON.parse(second.content[0].text)
    expect(secondParsed.next_offset).toBeNull()

    expect(firstParsed.content + secondParsed.content).toBe(full)
  })

  it('T23 – source_url is built from the CELLAR_REST_BASE constant', async () => {
    mockFetchDocument.mockResolvedValueOnce('<p>Content</p>')

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.source_url).toBe(`${CELLAR_REST_BASE}/32024R1689`)
  })

  it('T-TYPE – fetch output matches FetchResult interface fields', async () => {
    mockFetchDocument.mockResolvedValueOnce('<div><p>Content</p></div>')

    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    const parsed: FetchResult = JSON.parse(result.content[0].text)
    const requiredKeys: (keyof FetchResult)[] = [
      'celex_id',
      'language',
      'content',
      'truncated',
      'returned_chars',
      'total_chars',
      'offset',
      'next_offset',
      'source_url',
    ]
    for (const key of requiredKeys) {
      expect(parsed).toHaveProperty(key)
    }
    expect(parsed).not.toHaveProperty('char_count')
  })

  // -------------------------------------------------------------------------
  // Task 2: eli / oj_ref identifier inputs + XOR
  // -------------------------------------------------------------------------
  it('T-ELI – resolves an eli input to a CELEX, then fetches and reports it', async () => {
    mockResolveCelexId.mockResolvedValueOnce('32016R0679')
    mockFetchDocument.mockResolvedValueOnce('<p>GDPR text</p>')

    const result = await handleEurlexFetch({
      eli: 'reg/2016/679',
      language: 'ENG',
      format: 'plain',
      max_chars: 20000,
      offset: 0,
    })

    expect(mockResolveCelexId).toHaveBeenCalledWith(
      expect.objectContaining({ eli: 'reg/2016/679' })
    )
    expect(mockFetchDocument).toHaveBeenCalledWith('32016R0679', 'ENG')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32016R0679')
    expect(parsed.source_url).toBe(`${CELLAR_REST_BASE}/32016R0679`)
  })

  it('T-OJ – resolves an oj_ref input to a CELEX, then fetches and reports it', async () => {
    mockResolveCelexId.mockResolvedValueOnce('32024R1689')
    mockFetchDocument.mockResolvedValueOnce('<p>AI Act text</p>')

    const result = await handleEurlexFetch({
      oj_ref: 'OJ:L_202401689',
      language: 'ENG',
      format: 'plain',
      max_chars: 20000,
      offset: 0,
    })

    expect(mockFetchDocument).toHaveBeenCalledWith('32024R1689', 'ENG')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.celex_id).toBe('32024R1689')
  })

  it('T-XOR1 – rejects when two identifiers are given at once', async () => {
    const result = await handleEurlexFetch({
      celex_id: '32024R1689',
      eli: 'reg/2016/679',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/only one identifier/i)
    expect(mockFetchDocument).not.toHaveBeenCalled()
  })

  it('T-XOR2 – rejects when no identifier is given', async () => {
    const result = await handleEurlexFetch({
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/exactly one identifier/i)
    expect(mockFetchDocument).not.toHaveBeenCalled()
  })

  it('T-RESOLVE-ERR – surfaces a resolution failure as isError', async () => {
    mockResolveCelexId.mockRejectedValueOnce(
      new Error('Could not resolve ELI "reg/1800/999" (...): no matching EU act found.')
    )

    const result = await handleEurlexFetch({
      eli: 'reg/1800/999',
      language: 'DEU',
      format: 'xhtml',
      max_chars: 20000,
      offset: 0,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Could not resolve ELI')
    expect(mockFetchDocument).not.toHaveBeenCalled()
  })
})
