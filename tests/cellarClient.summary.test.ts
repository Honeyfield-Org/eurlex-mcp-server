import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'
import { CELLAR_SUMMARY_MIME } from '../src/constants.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

// A LEGISSUM summary row binding for the lookup query.
function sumRow(
  uri: string,
  legissumId: string | undefined,
  title: string | undefined,
  date: string | undefined,
  obsolete: string | undefined,
) {
  const b: Record<string, unknown> = { summary: { type: 'uri', value: uri } }
  if (legissumId !== undefined) b.legissumId = { type: 'literal', value: legissumId }
  if (title !== undefined) b.title = { type: 'literal', 'xml:lang': 'en', value: title }
  if (date !== undefined)
    b.date = { type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#date', value: date }
  if (obsolete !== undefined)
    b.obsolete = {
      type: 'literal',
      datatype: 'http://www.w3.org/2001/XMLSchema#boolean',
      value: obsolete,
    }
  return b
}

describe('buildSummaryQuery()', () => {
  const client = new CellarClient()

  it('BSQ1 – anchors on the act CELEX and the precise LEGISSUM relation', () => {
    const sparql = client.buildSummaryQuery('32016R0679', 'DEU')
    expect(sparql).toContain('FILTER(STR(?celexVal) = "32016R0679")')
    expect(sparql).toContain('cdm:summary_legislation_eu_summarizes_resource_legal ?act')
  })

  it('BSQ2 – selects the title in the requested language via the language-authority URI', () => {
    const sparql = client.buildSummaryQuery('32016R0679', 'POL')
    expect(sparql).toContain(
      'cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/POL>',
    )
    expect(sparql).toContain('cdm:expression_title ?title')
  })

  it('BSQ3 – selects id, date and obsolete flag optionally', () => {
    const sparql = client.buildSummaryQuery('32016R0679', 'ENG')
    expect(sparql).toContain('cdm:summary_legislation_eu_id_legissum ?legissumId')
    expect(sparql).toContain('cdm:work_date_document ?date')
    expect(sparql).toContain('cdm:summary_legislation_eu_obsolete ?obsolete')
  })

  it('BSQ4 – escapes double-quotes in the CELEX (defense-in-depth)', () => {
    const sparql = client.buildSummaryQuery('3"x', 'ENG')
    expect(sparql).toContain('3\\"x')
  })
})

describe('findSummaries()', () => {
  it('FS1 – maps bindings to SummaryMeta with obsolete "0"→false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            sumRow(
              'http://publications.europa.eu/resource/cellar/uuid-1',
              '310401_2',
              'General data protection regulation (GDPR)',
              '2026-03-24',
              '0',
            ),
          ],
        },
      }),
    })
    const client = new CellarClient()
    const list = await client.findSummaries('32016R0679', 'ENG')

    expect(list).toHaveLength(1)
    expect(list[0].uri).toBe('http://publications.europa.eu/resource/cellar/uuid-1')
    expect(list[0].legissum_id).toBe('310401_2')
    expect(list[0].title).toBe('General data protection regulation (GDPR)')
    expect(list[0].date).toBe('2026-03-24')
    expect(list[0].obsolete).toBe(false)
  })

  it('FS2 – parses obsolete "1" and "true" as true; missing as false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            sumRow('http://publications.europa.eu/resource/cellar/a', 'A', 't', '2020-01-01', '1'),
            sumRow(
              'http://publications.europa.eu/resource/cellar/b',
              'B',
              't',
              '2020-01-01',
              'true',
            ),
            sumRow(
              'http://publications.europa.eu/resource/cellar/c',
              'C',
              't',
              '2020-01-01',
              undefined,
            ),
          ],
        },
      }),
    })
    const client = new CellarClient()
    const list = await client.findSummaries('32016R0679', 'ENG')
    expect(list.map((s) => s.obsolete)).toEqual([true, true, false])
  })

  it('FS3 – missing legissumId/title/date bindings become empty strings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            sumRow(
              'http://publications.europa.eu/resource/cellar/x',
              undefined,
              undefined,
              undefined,
              '0',
            ),
          ],
        },
      }),
    })
    const client = new CellarClient()
    const list = await client.findSummaries('32016R0679', 'ENG')
    expect(list[0].legissum_id).toBe('')
    expect(list[0].title).toBe('')
    expect(list[0].date).toBe('')
  })

  it('FS4 – empty result set yields an empty list', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: { bindings: [] } }) })
    const client = new CellarClient()
    expect(await client.findSummaries('32024R9999', 'ENG')).toEqual([])
  })
})

describe('fetchSummaryDocument()', () => {
  it('FSD1 – GETs the summary work URI with the xhtml5 MIME and the ISO Accept-Language', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html>General data protection regulation</html>',
    })
    const client = new CellarClient()
    const uri = 'http://publications.europa.eu/resource/cellar/e899a0de'
    const raw = await client.fetchSummaryDocument(uri, 'DEU')

    expect(raw).toContain('General data protection regulation')
    const [calledUrl, options] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe(uri)
    const headers = (options as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe(CELLAR_SUMMARY_MIME)
    expect(headers['Accept-Language']).toBe('de') // DEU → de
  })

  it('FSD2 – a 404 (language variant missing) raises a clear error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
    const client = new CellarClient()
    await expect(
      client.fetchSummaryDocument('http://publications.europa.eu/resource/cellar/z', 'GLE'),
    ).rejects.toThrow(/not available/)
  })

  it('FSD3 – rejects a URI that is not a Cellar resource URI without hitting the network', async () => {
    const client = new CellarClient()
    await expect(client.fetchSummaryDocument('https://evil.example/x', 'ENG')).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
