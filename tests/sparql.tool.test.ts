import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SparqlRawResult } from '../src/types.js'

const { mockExecuteRawSparql } = vi.hoisted(() => ({ mockExecuteRawSparql: vi.fn() }))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: { executeRawSparql: mockExecuteRawSparql },
}))

import { handleEurlexSparql } from '../src/tools/sparql.js'

beforeEach(() => {
  vi.clearAllMocks()
})

function selectJson(bindings: unknown[], vars = ['s']) {
  return { head: { vars }, results: { bindings } }
}

describe('handleEurlexSparql()', () => {
  it('TH1 – happy path: returns bindings, row_count and the appended-LIMIT flag', async () => {
    mockExecuteRawSparql.mockResolvedValueOnce(
      selectJson([{ s: { type: 'uri', value: 'urn:a' } }, { s: { type: 'uri', value: 'urn:b' } }]),
    )

    const res = await handleEurlexSparql({ query: 'SELECT ?s WHERE { ?s ?p ?o }' })
    expect(res.isError).toBeFalsy()

    const out = JSON.parse(res.content[0].text) as SparqlRawResult
    expect(out.row_count).toBe(2)
    expect(out.returned_rows).toBe(2)
    expect(out.truncated).toBe(false)
    expect(out.vars).toEqual(['s'])
    expect(out.bindings).toHaveLength(2)
    expect(out.limit_added).toBe(true)
  })

  it('TH2 – passes the LIMIT-augmented query through to the client', async () => {
    mockExecuteRawSparql.mockResolvedValueOnce(selectJson([]))
    await handleEurlexSparql({ query: 'SELECT ?s WHERE { ?s ?p ?o }' })

    expect(mockExecuteRawSparql).toHaveBeenCalledTimes(1)
    const sent = mockExecuteRawSparql.mock.calls[0][0] as string
    expect(sent).toMatch(/LIMIT 50\s*$/)
  })

  it('TH3 – ASK: surfaces the boolean, no bindings, row_count null', async () => {
    mockExecuteRawSparql.mockResolvedValueOnce({ head: {}, boolean: true })

    const res = await handleEurlexSparql({ query: 'ASK { ?s ?p ?o }' })
    const out = JSON.parse(res.content[0].text) as SparqlRawResult
    expect(out.boolean).toBe(true)
    expect(out.row_count).toBeNull()
    expect(out.truncated).toBe(false)
    expect(out.bindings).toBeUndefined()
  })

  it('TH4 – truncation: many rows are dropped whole to fit the char budget', async () => {
    // Each row serializes to a few hundred chars; 5000 rows blow past 40k.
    const bindings = Array.from({ length: 5000 }, (_, i) => ({
      s: { type: 'uri', value: `http://publications.europa.eu/resource/celex/row-${i}` },
    }))
    mockExecuteRawSparql.mockResolvedValueOnce(selectJson(bindings))

    const res = await handleEurlexSparql({ query: 'SELECT ?s WHERE { ?s ?p ?o }' })
    const out = JSON.parse(res.content[0].text) as SparqlRawResult

    expect(out.truncated).toBe(true)
    expect(out.row_count).toBe(5000)
    expect(out.returned_rows).toBeLessThan(5000)
    expect(out.returned_rows).toBe(out.bindings?.length)
    // The FULL serialized response (envelope keys + bindings) stays within the
    // documented ~40k budget — not just the bindings array. The response text is
    // exactly what handleEurlexSparql returns.
    expect(res.content[0].text.length).toBeLessThanOrEqual(40000)
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(40000)
  })

  it('TH5 – a rejected query never touches the network', async () => {
    const res = await handleEurlexSparql({
      query: 'SELECT ?s WHERE { SERVICE <http://evil/s> { ?s ?p ?o } }',
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('SERVICE')
    expect(mockExecuteRawSparql).not.toHaveBeenCalled()
  })

  it('TH6 – a LIMIT over the max is rejected before any network call', async () => {
    const res = await handleEurlexSparql({ query: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 999' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/exceeds the maximum/)
    expect(mockExecuteRawSparql).not.toHaveBeenCalled()
  })

  it('TH7 – a client/endpoint error is surfaced as a structured error', async () => {
    mockExecuteRawSparql.mockRejectedValueOnce(new Error('SPARQL endpoint error: 400'))
    const res = await handleEurlexSparql({ query: 'SELECT ?s WHERE { ?s ?p ?o }' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Error')
  })
})
