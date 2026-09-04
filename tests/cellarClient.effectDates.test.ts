import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'
import { CELLAR_NOTICE_ACCEPT, CELLAR_REST_BASE } from '../src/constants.js'

const mockFetch = vi.fn()

const FD = 'http://publications.europa.eu/resource/authority/fd_335'
const NOTICE = `<NOTICE><WORK>
<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2018-05-25</VALUE><ANNOTATION><TYPE_OF_DATE>{MA|${FD}/MA}</TYPE_OF_DATE><COMMENT_ON_DATE>{V|${FD}/V} {ART|${FD}/ART} 99</COMMENT_ON_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2016-05-24</VALUE><ANNOTATION><TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE><COMMENT_ON_DATE>{DATPUB|${FD}/DATPUB} +20 {V|${FD}/V} {ART|${FD}/ART} 99</COMMENT_ON_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
</WORK></NOTICE>`

function ok(body: string) {
  return { ok: true, status: 200, text: async () => body }
}

/** Builds a client with a fake (non-sleeping) retryDelayFn, mirroring cellarClient.retry.test.ts. */
function makeClientWithFakeDelay(): CellarClient {
  return new CellarClient({ retryDelayFn: vi.fn().mockResolvedValue(undefined) })
}

describe('CellarClient – effectDatesQuery()', () => {
  let client = new CellarClient()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    client = new CellarClient()
  })

  it('GETs the object notice for the CELEX and returns the typed dates', async () => {
    mockFetch.mockResolvedValueOnce(ok(NOTICE))

    const dates = await client.effectDatesQuery('32016R0679')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(`${CELLAR_REST_BASE}/32016R0679`)
    expect(init.method).toBe('GET')
    expect(init.headers.Accept).toBe(CELLAR_NOTICE_ACCEPT)
    expect(init.redirect).toBe('follow')
    expect(dates).toEqual([
      { date: '2016-05-24', type: 'entry_into_force', note: 'Date pub. +20 See Art 99' },
      { date: '2018-05-25', type: 'application', note: 'See Art 99' },
    ])
  })

  it('caches the parsed dates per CELEX and returns copies', async () => {
    mockFetch.mockResolvedValueOnce(ok(NOTICE))

    const first = await client.effectDatesQuery('32016R0679')
    const second = await client.effectDatesQuery('32016R0679')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second?.[0]).not.toBe(first?.[0])
  })

  it('returns null on 404 and caches the miss', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })

    expect(await client.effectDatesQuery('32099R9999')).toBeNull()
    expect(await client.effectDatesQuery('32099R9999')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns null on 406 (no notice rendition)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 406, text: async () => '' })
    expect(await client.effectDatesQuery('32016R0679')).toBeNull()
  })

  it('retries a 202 (notice still generating) and then succeeds', async () => {
    client = makeClientWithFakeDelay()
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 202, text: async () => '' })
      .mockResolvedValueOnce(ok(NOTICE))

    const dates = await client.effectDatesQuery('32016R0679')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(dates?.map((d) => d.date)).toEqual(['2016-05-24', '2018-05-25'])
  })

  it('throws after retries on persistent 5xx and does not cache the failure', async () => {
    client = makeClientWithFakeDelay()
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' })

    await expect(client.effectDatesQuery('32016R0679')).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(3) // 1 + MAX_RETRIES (2)

    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(ok(NOTICE))
    expect(await client.effectDatesQuery('32016R0679')).toHaveLength(2)
  })

  it('returns [] (not null) for a notice without effect-date blocks', async () => {
    mockFetch.mockResolvedValueOnce(ok('<NOTICE><WORK></WORK></NOTICE>'))
    expect(await client.effectDatesQuery('32016R0679')).toEqual([])
  })
})
