import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// ---------------------------------------------------------------------------
// Mock the Cellar client at the module boundary. createServer() wires the real
// tool handlers to `sharedCellarClient`, so mocking it here lets every tool run
// its real handler (which builds `structuredContent`) with no network, driven
// end-to-end through a real McpServer + Client pair over the in-memory transport.
// ---------------------------------------------------------------------------
const mock = vi.hoisted(() => ({
  sparqlQuery: vi.fn(),
  resolveCelexId: vi.fn(),
  fetchDocument: vi.fn(),
  metadataQuery: vi.fn(),
  citationsQuery: vi.fn(),
  resolveEurovocLabel: vi.fn(),
  eurovocQuery: vi.fn(),
  fetchConsolidated: vi.fn(),
  caseLawQuery: vi.fn(),
  transpositionQuery: vi.fn(),
  findSummaries: vi.fn(),
  fetchSummaryDocument: vi.fn(),
  executeRawSparql: vi.fn(),
}))

vi.mock('../src/services/cellarClient.js', () => ({
  CellarClient: vi.fn(),
  sharedCellarClient: mock,
}))

import { createServer } from '../src/server.js'
import { searchOutputSchema } from '../src/schemas/searchSchema.js'
import { eurovocOutputSchema } from '../src/schemas/eurovocSchema.js'
import { fetchOutputSchema } from '../src/schemas/fetchSchema.js'
import { metadataOutputSchema } from '../src/schemas/metadataSchema.js'
import { citationsOutputSchema } from '../src/schemas/citationsSchema.js'
import { consolidatedOutputSchema } from '../src/schemas/consolidatedSchema.js'
import { caseLawOutputSchema } from '../src/schemas/caseLawSchema.js'
import { transpositionOutputSchema } from '../src/schemas/transpositionSchema.js'
import { structureOutputSchema } from '../src/schemas/structureSchema.js'
import { summaryOutputSchema } from '../src/schemas/summarySchema.js'
import { sparqlOutputSchema } from '../src/schemas/sparqlSchema.js'
import type { CaseLawResult, CitationsResult, MetadataResult, TranspositionResult } from '../src/types.js'

// ---------------------------------------------------------------------------
// Test fixtures — realistic mock returns for each Cellar method.
// ---------------------------------------------------------------------------
const searchHit = {
  celex: '32016R0679',
  title: 'General Data Protection Regulation',
  date: '2016-04-27',
  type: 'REG',
  eurlex_url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:32016R0679',
}

const metadataFull: MetadataResult = {
  celex_id: '32016R0679',
  title: 'General Data Protection Regulation',
  date_document: '2016-04-27',
  date_entry_into_force: '2016-05-24',
  date_end_of_validity: null,
  in_force: true,
  date_transposition: null,
  resource_type: 'REG',
  authors: ['European Parliament', 'Council of the European Union'],
  eurovoc_concepts: ['data protection'],
  directory_codes: ['13.20.60: Data protection'],
  legal_basis: ['12016E016'],
  eurlex_url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:32016R0679',
}

const citationsFull: CitationsResult = {
  celex_id: '32016R0679',
  citations: [
    {
      celex: '31995L0046',
      title: 'Data Protection Directive',
      date: '1995-10-24',
      type: 'DIR',
      relationship: 'repeals',
      eurlex_url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:31995L0046',
    },
  ],
  total: 1,
  counts: { cites: 1, cited_by: 0 },
}

const caseLawFull: CaseLawResult = {
  results: [
    {
      celex: '62012CJ0131',
      ecli: 'ECLI:EU:C:2014:317',
      title: 'Google Spain',
      date: '2014-05-13',
      type: 'JUDG',
      eurlex_url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:62012CJ0131',
    },
  ],
  total: 1,
}

const transpositionFull: TranspositionResult = {
  celex_id: '32022L2555',
  results: [
    {
      country: 'DE',
      title: 'NIS2-Umsetzungsgesetz',
      date: '2024-10-01',
      celex: '72022L2555DEU_202500123',
      eurlex_url: 'https://eur-lex.europa.eu/legal-content/DE/AUTO/?uri=CELEX:72022L2555DEU_202500123',
    },
  ],
  returned: 1,
  total_found: 1,
}

// XHTML whose stripped plain text carries real headings (structure happy path).
const STRUCTURED_XHTML =
  '<html><body>\n' +
  '<p class="oj-ti-art">Article 1</p>\n<p class="oj-sti-art">Subject matter</p>\n' +
  '<p class="oj-ti-art">Article 2</p>\n<p class="oj-sti-art">Scope</p>\n' +
  '</body></html>'

const summaryMeta = {
  uri: 'http://publications.europa.eu/resource/cellar/primary',
  legissum_id: '310401_2',
  title: 'General data protection regulation (GDPR)',
  date: '2026-03-24',
  obsolete: false,
}

const TOOL_NAMES = [
  'eurlex_search',
  'eurlex_fetch',
  'eurlex_metadata',
  'eurlex_citations',
  'eurlex_by_eurovoc',
  'eurlex_consolidated',
  'eurlex_case_law',
  'eurlex_transposition',
  'eurlex_structure',
  'eurlex_summary',
  'eurlex_sparql',
] as const

// ---------------------------------------------------------------------------
// Server + client harness. listTools() caches the output-schema validators on
// the client, so every subsequent callTool() validates structuredContent
// against the tool's declared outputSchema (the SDK throws on a mismatch).
// ---------------------------------------------------------------------------
const transports: Array<{ close: () => Promise<void> }> = []

async function connectedClient(): Promise<{ client: Client; tools: Awaited<ReturnType<Client['listTools']>>['tools'] }> {
  const server = createServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  transports.push(clientTransport, serverTransport)
  const { tools } = await client.listTools()
  return { client, tools }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override with mockResolvedValueOnce.
  mock.resolveCelexId.mockImplementation(async (i: { celex_id?: string }) => i.celex_id ?? '32016R0679')
  mock.fetchDocument.mockResolvedValue(STRUCTURED_XHTML)
})

afterEach(async () => {
  for (const t of transports) {
    try {
      await t.close()
    } catch {
      // ignore cleanup errors
    }
  }
  transports.length = 0
})

// ===========================================================================
// outputSchema exposure — tools/list must advertise an outputSchema for all 11
// ===========================================================================
describe('outputSchema exposure (tools/list)', () => {
  it('every tool advertises an outputSchema object', async () => {
    const { tools } = await connectedClient()
    expect(tools).toHaveLength(TOOL_NAMES.length)
    for (const name of TOOL_NAMES) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, `tool ${name} present`).toBeDefined()
      expect(tool?.outputSchema, `tool ${name} has outputSchema`).toBeDefined()
      expect(tool?.outputSchema?.type).toBe('object')
    }
  })
})

// ===========================================================================
// structuredContent conformance — end-to-end callTool (client validates against
// the JSON schema) + explicit zod .parse on the returned structuredContent.
// Happy path + one edge per tool.
// ===========================================================================
describe('structuredContent conformance', () => {
  it('eurlex_search — happy: results + total', async () => {
    mock.sparqlQuery.mockResolvedValueOnce({ results: [searchHit], sparql: 'SELECT ...' })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_search', arguments: { query: 'data protection' } })
    expect(res.structuredContent).toBeDefined()
    const out = searchOutputSchema.parse(res.structuredContent)
    expect(out.total).toBe(1)
  })

  it('eurlex_search — edge: empty results still carries {results:[],total:0}', async () => {
    mock.sparqlQuery.mockResolvedValueOnce({ results: [], sparql: 'SELECT ...' })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_search', arguments: { query: 'zzz nothing' } })
    expect(res.structuredContent).toEqual({ results: [], total: 0 })
    searchOutputSchema.parse(res.structuredContent)
  })

  it('eurlex_fetch — happy: truncated window has a numeric next_offset', async () => {
    mock.fetchDocument.mockResolvedValueOnce('x'.repeat(1500))
    const { client } = await connectedClient()
    const res = await client.callTool({
      name: 'eurlex_fetch',
      arguments: { celex_id: '32016R0679', format: 'plain', max_chars: 1000 },
    })
    const out = fetchOutputSchema.parse(res.structuredContent)
    expect(out.truncated).toBe(true)
    expect(out.next_offset).toBe(1000)
  })

  it('eurlex_fetch — edge: full document has next_offset null', async () => {
    mock.fetchDocument.mockResolvedValueOnce('short document')
    const { client } = await connectedClient()
    const res = await client.callTool({
      name: 'eurlex_fetch',
      arguments: { celex_id: '32016R0679', format: 'plain', max_chars: 1000 },
    })
    const out = fetchOutputSchema.parse(res.structuredContent)
    expect(out.truncated).toBe(false)
    expect(out.next_offset).toBeNull()
  })

  it('eurlex_metadata — happy: populated fields', async () => {
    mock.metadataQuery.mockResolvedValueOnce(metadataFull)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_metadata', arguments: { celex_id: '32016R0679' } })
    const out = metadataOutputSchema.parse(res.structuredContent)
    expect(out.in_force).toBe(true)
  })

  it('eurlex_metadata — edge: all-null dates + null in_force validate', async () => {
    const nulls: MetadataResult = {
      ...metadataFull,
      date_document: null,
      date_entry_into_force: null,
      date_end_of_validity: null,
      in_force: null,
      date_transposition: null,
      authors: [],
      eurovoc_concepts: [],
      directory_codes: [],
      legal_basis: [],
    }
    mock.metadataQuery.mockResolvedValueOnce(nulls)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_metadata', arguments: { celex_id: '32016R0679' } })
    const out = metadataOutputSchema.parse(res.structuredContent)
    expect(out.in_force).toBeNull()
    expect(out.date_document).toBeNull()
  })

  it('eurlex_citations — happy: entries + counts', async () => {
    mock.citationsQuery.mockResolvedValueOnce(citationsFull)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_citations', arguments: { celex_id: '32016R0679' } })
    const out = citationsOutputSchema.parse(res.structuredContent)
    expect(out.counts).toEqual({ cites: 1, cited_by: 0 })
  })

  it('eurlex_citations — edge: empty citations with zeroed counts', async () => {
    const empty: CitationsResult = {
      celex_id: '32016R0679',
      citations: [],
      total: 0,
      counts: { cites: 0, cited_by: 0 },
    }
    mock.citationsQuery.mockResolvedValueOnce(empty)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_citations', arguments: { celex_id: '32016R0679' } })
    expect(res.structuredContent).toEqual(empty)
    citationsOutputSchema.parse(res.structuredContent)
  })

  it('eurlex_by_eurovoc — happy: results + total', async () => {
    mock.resolveEurovocLabel.mockResolvedValueOnce('http://eurovoc.europa.eu/4424')
    mock.eurovocQuery.mockResolvedValueOnce([searchHit])
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_by_eurovoc', arguments: { concept: 'data protection' } })
    const out = eurovocOutputSchema.parse(res.structuredContent)
    expect(out.total).toBe(1)
  })

  it('eurlex_by_eurovoc — edge: unresolved concept carries {results:[],total:0}', async () => {
    mock.resolveEurovocLabel.mockResolvedValueOnce(null)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_by_eurovoc', arguments: { concept: 'no such concept' } })
    expect(res.structuredContent).toEqual({ results: [], total: 0 })
    eurovocOutputSchema.parse(res.structuredContent)
  })

  it('eurlex_consolidated — happy: consolidation_date parsed from CELEX suffix', async () => {
    mock.fetchConsolidated.mockResolvedValueOnce({
      content: 'consolidated text',
      eliUrl: 'http://data.europa.eu/eli/reg/2016/679/2016-05-04',
      consolidatedCelex: '02016R0679-20160504',
    })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_consolidated', arguments: { celex_id: '32016R0679', format: 'plain' } })
    const out = consolidatedOutputSchema.parse(res.structuredContent)
    expect(out.consolidation_date).toBe('2016-05-04')
    expect(out.consolidated_celex).toBe('02016R0679-20160504')
  })

  it('eurlex_consolidated — edge: no date suffix → consolidation_date null', async () => {
    mock.fetchConsolidated.mockResolvedValueOnce({
      content: 'consolidated text',
      eliUrl: 'http://data.europa.eu/eli/reg/2016/679',
      consolidatedCelex: '02016R0679',
    })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_consolidated', arguments: { celex_id: '32016R0679', format: 'plain' } })
    const out = consolidatedOutputSchema.parse(res.structuredContent)
    expect(out.consolidation_date).toBeNull()
  })

  it('eurlex_case_law — happy: results + total', async () => {
    mock.caseLawQuery.mockResolvedValueOnce(caseLawFull)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_case_law', arguments: { ecli: 'ECLI:EU:C:2014:317' } })
    const out = caseLawOutputSchema.parse(res.structuredContent)
    expect(out.total).toBe(1)
    expect(out.results[0].ecli).toBe('ECLI:EU:C:2014:317')
  })

  it('eurlex_case_law — edge: empty results', async () => {
    mock.caseLawQuery.mockResolvedValueOnce({ results: [], total: 0 })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_case_law', arguments: { query: 'no such case' } })
    expect(res.structuredContent).toEqual({ results: [], total: 0 })
    caseLawOutputSchema.parse(res.structuredContent)
  })

  it('eurlex_transposition — happy: measures + counts', async () => {
    mock.transpositionQuery.mockResolvedValueOnce(transpositionFull)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_transposition', arguments: { celex_id: '32022L2555' } })
    const out = transpositionOutputSchema.parse(res.structuredContent)
    expect(out.returned).toBe(1)
    expect(out.total_found).toBe(1)
  })

  it('eurlex_transposition — edge: empty results', async () => {
    const empty: TranspositionResult = { celex_id: '32022L2555', results: [], returned: 0, total_found: 0 }
    mock.transpositionQuery.mockResolvedValueOnce(empty)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_transposition', arguments: { celex_id: '32022L2555' } })
    expect(res.structuredContent).toEqual(empty)
    transpositionOutputSchema.parse(res.structuredContent)
  })

  it('eurlex_structure — happy: outline with offsets', async () => {
    mock.fetchDocument.mockResolvedValueOnce(STRUCTURED_XHTML)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_structure', arguments: { celex_id: '32024R1689', language: 'ENG' } })
    const out = structureOutputSchema.parse(res.structuredContent)
    expect(out.outline.map((e) => e.label)).toEqual(['Article 1', 'Article 2'])
    expect(out.note).toBeUndefined()
  })

  it('eurlex_structure — edge: structureless document has a note and empty outline', async () => {
    mock.fetchDocument.mockResolvedValueOnce('<html><body><p>An unstructured decision.</p></body></html>')
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_structure', arguments: { celex_id: '32024D0001', language: 'ENG' } })
    const out = structureOutputSchema.parse(res.structuredContent)
    expect(out.outline).toEqual([])
    expect(out.note).toContain('No chapter/section/article/annex headings')
  })

  it('eurlex_summary — happy: full summary object', async () => {
    mock.findSummaries.mockResolvedValueOnce([summaryMeta])
    mock.fetchSummaryDocument.mockResolvedValueOnce('<p>SUMMARY OF: Regulation (EU) 2016/679.</p>')
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_summary', arguments: { celex_id: '32016R0679', language: 'ENG' } })
    const out = summaryOutputSchema.parse(res.structuredContent)
    expect(out.total_summaries).toBe(1)
    expect(out.legissum_id).toBe('310401_2')
    expect(out.content).toContain('SUMMARY OF')
  })

  it('eurlex_summary — edge: no summary → total_summaries 0 and no content fields', async () => {
    mock.findSummaries.mockResolvedValueOnce([])
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_summary', arguments: { celex_id: '32024R9999', language: 'ENG' } })
    expect(res.structuredContent).toEqual({ celex_id: '32024R9999', language: 'ENG', total_summaries: 0 })
    const out = summaryOutputSchema.parse(res.structuredContent)
    expect(out.content).toBeUndefined()
  })

  it('eurlex_summary — multi-summary: fetches primary, populates other_summaries array', async () => {
    mock.findSummaries.mockResolvedValueOnce([
      {
        uri: 'obsolete-old',
        legissum_id: '111',
        title: 'Old summary title',
        date: '2015-01-01',
        obsolete: true,
      },
      {
        uri: 'current',
        legissum_id: '222',
        title: 'General data protection regulation (GDPR)',
        date: '2024-01-01',
        obsolete: false,
      },
    ])
    mock.fetchSummaryDocument.mockResolvedValueOnce('<p>current summary content</p>')
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_summary', arguments: { celex_id: '32016R0679', language: 'ENG' } })
    const out = summaryOutputSchema.parse(res.structuredContent)
    expect(out.total_summaries).toBe(2)
    expect(out.legissum_id).toBe('222')
    expect(out.obsolete).toBe(false)
    expect(out.other_summaries).toHaveLength(1)
    expect(out.other_summaries?.[0].legissum_id).toBe('111')
    expect(out.other_summaries?.[0].obsolete).toBe(true)
    expect(out.other_summaries?.[0].title).toBeDefined()
    expect(out.other_summaries?.[0].date).toBeDefined()
  })

  it('eurlex_sparql — happy (SELECT): vars + bindings + numeric row_count', async () => {
    mock.executeRawSparql.mockResolvedValueOnce({
      head: { vars: ['celex'] },
      results: { bindings: [{ celex: { type: 'literal', value: '32016R0679' } }] },
    })
    const { client } = await connectedClient()
    const res = await client.callTool({
      name: 'eurlex_sparql',
      arguments: { query: 'SELECT ?celex WHERE { ?w ?p ?celex } LIMIT 1' },
    })
    const out = sparqlOutputSchema.parse(res.structuredContent)
    expect(out.vars).toEqual(['celex'])
    expect(out.row_count).toBe(1)
    expect(out.boolean).toBeUndefined()
  })

  it('eurlex_sparql — edge (ASK): boolean present, row_count null, no bindings', async () => {
    mock.executeRawSparql.mockResolvedValueOnce({ boolean: true })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_sparql', arguments: { query: 'ASK { ?s ?p ?o }' } })
    const out = sparqlOutputSchema.parse(res.structuredContent)
    expect(out.boolean).toBe(true)
    expect(out.row_count).toBeNull()
    expect(out.returned_rows).toBeNull()
    expect(out.bindings).toBeUndefined()
  })

  it('eurlex_sparql — edge (SELECT without LIMIT): limit_added flag set', async () => {
    mock.executeRawSparql.mockResolvedValueOnce({ head: { vars: ['x'] }, results: { bindings: [] } })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_sparql', arguments: { query: 'SELECT ?x WHERE { ?x ?p ?o }' } })
    const out = sparqlOutputSchema.parse(res.structuredContent)
    expect(out.limit_added).toBe(true)
  })

  it('eurlex_sparql — minor: SELECT response without head.vars', async () => {
    mock.executeRawSparql.mockResolvedValueOnce({ head: {}, results: { bindings: [{ x: { type: 'literal', value: 'test' } }] } })
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_sparql', arguments: { query: 'SELECT * WHERE { ?x ?p ?o } LIMIT 10' } })
    const out = sparqlOutputSchema.parse(res.structuredContent)
    expect(out.vars).toBeUndefined()
    expect(out.row_count).toBe(1)
  })

  it('eurlex_structure — minor: truncated outline with note present', async () => {
    const manyHeadings =
      '<html><body>' +
      Array.from({ length: 350 }, (_, i) => `<p class="oj-ti-art">Article ${i + 1}</p>`).join('\n') +
      '</body></html>'
    mock.fetchDocument.mockResolvedValueOnce(manyHeadings)
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_structure', arguments: { celex_id: '32024R1689', language: 'ENG' } })
    const out = structureOutputSchema.parse(res.structuredContent)
    expect(out.truncated).toBe(true)
    expect(out.note).toBeDefined()
    expect(out.outline.length).toBe(300)
    expect(out.total_headings).toBe(350)
  })
})

// ===========================================================================
// Error path — errors carry isError text and NO structuredContent (the SDK
// skips output validation when isError is set, per the brief).
// ===========================================================================
describe('error path', () => {
  it('a handler failure returns isError text without structuredContent', async () => {
    mock.sparqlQuery.mockRejectedValueOnce(new Error('SPARQL endpoint error: 503'))
    const { client } = await connectedClient()
    const res = await client.callTool({ name: 'eurlex_search', arguments: { query: 'data protection' } })
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toBeUndefined()
    expect((res.content as { text: string }[])[0].text).toContain('Error')
  })
})
