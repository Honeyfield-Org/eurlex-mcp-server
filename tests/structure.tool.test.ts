import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StructureResult } from '../src/types.js'

const { mockResolveCelexId, mockFetchDocument } = vi.hoisted(() => ({
  mockResolveCelexId: vi.fn(),
  mockFetchDocument: vi.fn(),
}))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: {
    resolveCelexId: mockResolveCelexId,
    fetchDocument: mockFetchDocument,
  },
}))

import { handleEurlexStructure } from '../src/tools/structure.js'

// stripHtml + parseOutline are exercised for real (only the network is mocked).
const XHTML =
  '<html><body>\n' +
  '<p class="oj-ti-section-1">CHAPTER I</p>\n<p class="oj-ti-section-2">GENERAL PROVISIONS</p>\n' +
  '<p class="oj-ti-art">Article 1</p>\n<p class="oj-sti-art">Subject matter</p>\n' +
  '<p class="oj-ti-art">Article 2</p>\n<p class="oj-sti-art">Scope</p>\n' +
  '</body></html>'

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveCelexId.mockImplementation(async (i: { celex_id?: string }) => i.celex_id ?? '32024R1689')
  mockFetchDocument.mockResolvedValue(XHTML)
})

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text) as StructureResult

describe('handleEurlexStructure()', () => {
  it('ST1 – celex_id: returns an outline with correct offsets and echoes the resolved CELEX', async () => {
    const res = await handleEurlexStructure({ celex_id: '32024R1689', language: 'ENG' })
    expect(res.isError).toBeFalsy()

    const out = parse(res)
    expect(out.celex_id).toBe('32024R1689')
    expect(out.language).toBe('ENG')
    expect(out.outline.map((e) => e.label)).toEqual(['CHAPTER I', 'Article 1', 'Article 2'])
    expect(out.total_headings).toBe(3)
    expect(out.returned).toBe(3)
    expect(out.truncated).toBe(false)
    expect(out.source_url).toContain('32024R1689')

    // Offset coupling holds through the tool: the stripped text at Article 1's
    // offset begins with the Article 1 heading.
    const stripped = XHTML.replace(/<[^>]*>/g, '')
    const art1 = out.outline.find((e) => e.label === 'Article 1')!
    expect(stripped.slice(art1.offset).startsWith('Article 1')).toBe(true)
  })

  it('ST2 – eli: forwards the identifier to resolveCelexId and uses the resolved CELEX', async () => {
    mockResolveCelexId.mockResolvedValueOnce('32016R0679')

    const res = await handleEurlexStructure({ eli: 'reg/2016/679', language: 'ENG' })

    expect(res.isError).toBeFalsy()
    expect(mockResolveCelexId).toHaveBeenCalledWith(expect.objectContaining({ eli: 'reg/2016/679' }))
    expect(parse(res).celex_id).toBe('32016R0679')
  })

  it('ST3 – forwards the language to fetchDocument', async () => {
    await handleEurlexStructure({ celex_id: '32024R1689', language: 'DEU' })
    expect(mockFetchDocument).toHaveBeenCalledWith('32024R1689', 'DEU')
  })

  it('ST4 – rejects when more than one identifier is provided (XOR)', async () => {
    const res = await handleEurlexStructure({
      celex_id: '32024R1689',
      eli: 'reg/2016/679',
      language: 'ENG',
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('only one identifier')
    expect(mockFetchDocument).not.toHaveBeenCalled()
  })

  it('ST5 – rejects when no identifier is provided', async () => {
    const res = await handleEurlexStructure({ language: 'ENG' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('exactly one identifier')
  })

  it('ST6 – structureless document: empty outline with an explanatory note, not an error', async () => {
    mockFetchDocument.mockResolvedValueOnce('<html><body><p>A short unstructured decision.</p></body></html>')

    const res = await handleEurlexStructure({ celex_id: '32024D0001', language: 'ENG' })

    expect(res.isError).toBeFalsy()
    const out = parse(res)
    expect(out.outline).toEqual([])
    expect(out.total_headings).toBe(0)
    expect(out.note).toContain('No chapter/section/article/annex headings')
  })

  it('ST6a – truncated outline: returned entries capped but total_headings and note reflect the full count', async () => {
    // Generate XHTML with 305 articles (exceeds the 300-entry cap).
    // Each article is on its own line in the stripped plain text.
    const lines: string[] = ['<html><body>']
    for (let n = 1; n <= 305; n++) {
      lines.push(`<p class="oj-ti-art">Article ${n}</p>`)
      lines.push(`<p class="oj-sti-art">Title of article ${n}</p>`)
    }
    lines.push('</body></html>')
    const html = lines.join('\n')
    mockFetchDocument.mockResolvedValueOnce(html)

    const res = await handleEurlexStructure({ celex_id: '32024R1689', language: 'ENG' })

    expect(res.isError).toBeFalsy()
    const out = parse(res)
    expect(out.total_headings).toBe(305)
    expect(out.returned).toBe(300)
    expect(out.truncated).toBe(true)
    expect(out.note).toBe('Outline truncated to 300 of 305 headings.')
  })

  it('ST7 – surfaces a fetch error as a structured error', async () => {
    mockFetchDocument.mockRejectedValueOnce(new Error('Document not found: 32024R9999.'))

    const res = await handleEurlexStructure({ celex_id: '32024R9999', language: 'ENG' })

    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Document not found')
  })
})
