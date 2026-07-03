import { describe, it, expect, vi, beforeEach } from 'vitest'

import { CellarClient } from '../src/services/cellarClient.js'

// ---------------------------------------------------------------------------
// Mock fetch + fake (non-sleeping) retry delay
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

/** Builds a client with a fake retryDelayFn so tests never sleep for real. */
function makeClientWithFakeDelay(): { client: CellarClient; delayFn: ReturnType<typeof vi.fn> } {
  const delayFn = vi.fn().mockResolvedValue(undefined)
  const client = new CellarClient({ retryDelayFn: delayFn })
  return { client, delayFn }
}

function sparqlOk(bindings: unknown[] = []) {
  return { ok: true, json: async () => ({ results: { bindings } }) }
}

function sparql5xx(status = 500) {
  return { ok: false, status, statusText: 'Internal Server Error' }
}

function restOk(text = '<html></html>') {
  return { ok: true, text: async () => text }
}

function rest5xx(status = 503) {
  return { ok: false, status, statusText: 'Service Unavailable' }
}

// ===========================================================================
// executeSparql retry behaviour (exercised via sparqlQuery)
// ===========================================================================
describe('executeSparql() retry', () => {
  it('retries once on 5xx then succeeds, with injected delay of 500ms', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce(sparql5xx(500)).mockResolvedValueOnce(sparqlOk())

    const { results } = await client.sparqlQuery('test')

    expect(results).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
    expect(delayFn).toHaveBeenCalledWith(500)
  })

  it('retries with 500ms then 1500ms delays and throws after 3 total attempts (2 retries)', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch
      .mockResolvedValueOnce(sparql5xx(500))
      .mockResolvedValueOnce(sparql5xx(500))
      .mockResolvedValueOnce(sparql5xx(500))

    await expect(client.sparqlQuery('test')).rejects.toThrow('SPARQL endpoint error: 500')

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(delayFn).toHaveBeenNthCalledWith(1, 500)
    expect(delayFn).toHaveBeenNthCalledWith(2, 1500)
  })

  it('does not retry on a 4xx SPARQL error', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce(sparql5xx(400))

    await expect(client.sparqlQuery('test')).rejects.toThrow('SPARQL endpoint error: 400')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(delayFn).not.toHaveBeenCalled()
  })

  it('retries on network TypeError then succeeds', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(sparqlOk())

    const { results } = await client.sparqlQuery('test')

    expect(results).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
  })

  it('throws an actionable timeout message after exhausting retries on AbortError/TimeoutError', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    mockFetch.mockRejectedValue(timeoutError)

    await expect(client.sparqlQuery('data protection')).rejects.toThrow(
      /SPARQL query timed out after 30s \(after 2 retries\)\. The Cellar endpoint is slow for broad queries — narrow the search with resource_type, date_from\/date_to, or a more specific query\./,
    )

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(delayFn).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// fetchCellarDocument retry behaviour (exercised via fetchDocument)
// ===========================================================================
describe('fetchDocument() via shared fetchCellarDocument() helper — retry', () => {
  it('retries once on 5xx then succeeds', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce(rest5xx(503)).mockResolvedValueOnce(restOk('<html>ok</html>'))

    const result = await client.fetchDocument('32021R0694', 'DEU')

    expect(result).toBe('<html>ok</html>')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
    expect(delayFn).toHaveBeenCalledWith(500)
  })

  it('throws after 3 total attempts (2 retries) on repeated 5xx', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch
      .mockResolvedValueOnce(rest5xx(503))
      .mockResolvedValueOnce(rest5xx(503))
      .mockResolvedValueOnce(rest5xx(503))

    await expect(client.fetchDocument('32021R0694', 'DEU')).rejects.toThrow('Fetch error: 503')

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(delayFn).toHaveBeenNthCalledWith(1, 500)
    expect(delayFn).toHaveBeenNthCalledWith(2, 1500)
  })

  it('does NOT retry on 404 (non-retryable)', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(client.fetchDocument('00000X0000', 'DEU')).rejects.toThrow('Document not found')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(delayFn).not.toHaveBeenCalled()
  })

  it('does NOT retry on 406 (non-retryable)', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 406 })

    await expect(client.fetchDocument('31995L0046', 'DEU')).rejects.toThrow('not available in XHTML format')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(delayFn).not.toHaveBeenCalled()
  })

  it('retries on network TypeError then succeeds', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(restOk('<html>ok</html>'))

    const result = await client.fetchDocument('32021R0694', 'DEU')

    expect(result).toBe('<html>ok</html>')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// fetchConsolidated() shares the same helper — same retry semantics on the
// REST step (proves both fetch paths share one implementation)
// ===========================================================================
describe('fetchConsolidated() via shared fetchCellarDocument() helper — retry', () => {
  function sparqlCelex(celex: string) {
    return { ok: true, json: async () => ({ results: { bindings: [{ celex: { type: 'literal', value: celex } }] } }) }
  }

  it('retries the REST step once on 5xx then succeeds', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch
      .mockResolvedValueOnce(sparqlCelex('02024R1689-20240712'))
      .mockResolvedValueOnce(rest5xx(503))
      .mockResolvedValueOnce(restOk('<html>consolidated</html>'))

    const result = await client.fetchConsolidated('reg', 2024, 1689, 'DEU')

    expect(result.content).toBe('<html>consolidated</html>')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(delayFn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry the REST step on 404 (non-retryable)', async () => {
    const { client, delayFn } = makeClientWithFakeDelay()
    mockFetch.mockResolvedValueOnce(sparqlCelex('02024R1689-20240712')).mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(client.fetchConsolidated('reg', 2024, 1689, 'DEU')).rejects.toThrow(/eurlex_fetch/)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(delayFn).not.toHaveBeenCalled()
  })
})
