import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellarClient } from '../src/services/cellarClient.js'
import { SPARQL_ENDPOINT } from '../src/constants.js'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('executeRawSparql()', () => {
  it('ER1 – POSTs the query verbatim to the SPARQL endpoint and returns the parsed JSON', async () => {
    const payload = { head: { vars: ['s'] }, results: { bindings: [{ s: { value: 'x' } }] } }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload })

    const client = new CellarClient()
    const query = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1'
    const data = await client.executeRawSparql(query)

    expect(data).toEqual(payload)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(SPARQL_ENDPOINT)
    expect((options as RequestInit).method).toBe('POST')
    expect((options as RequestInit).body).toBe(query)
    const headers = (options as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe('application/sparql-results+json')
  })

  it('ER2 – propagates a 4xx endpoint error (e.g. a SPARQL syntax error)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
    const client = new CellarClient()
    await expect(client.executeRawSparql('SELECT ?s WHERE { ?s ?p ?o }')).rejects.toThrow(/400/)
  })
})
