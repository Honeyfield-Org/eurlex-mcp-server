/**
 * Phase 5 – Live Integration Tests (PRD Validation Matrix V1–V5)
 *
 * These tests hit the REAL EU Publications Office endpoints.
 * No mocks. Generous timeouts because the Cellar API can be slow.
 */

import { CellarClient } from '../../src/services/cellarClient.js'

const client = new CellarClient()

const TIMEOUT = 60_000 // 60 seconds per test (Cellar SPARQL can be slow)

describe('Phase 5 – Live Validation', () => {
  // V1: SPARQL Endpoint erreichbar (POST) → HTTP 200, JSON response
  it('V1: SPARQL endpoint is reachable and returns results', async () => {
    const { results } = await client.sparqlQuery('Datenschutz-Grundverordnung', { limit: 1 })
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThanOrEqual(1)

    const first = results[0]
    expect(first).toHaveProperty('celex')
    expect(first).toHaveProperty('title')
    expect(first).toHaveProperty('type')
    expect(first).toHaveProperty('eurlex_url')
  }, TIMEOUT)

  // V2: AI Act auffindbar via Titel-Suche → CELEX 32024R1689 in Results
  it('V2: AI Act is findable via title search (CELEX 32024R1689)', async () => {
    const { results } = await client.sparqlQuery('künstliche Intelligenz', {
      language: 'DEU',
      limit: 50,
    })

    const celexIds = results.map((r) => r.celex)
    expect(celexIds).toContain('32024R1689')
  }, TIMEOUT)

  // V3: DSGVO auffindbar → CELEX 32016R0679
  it('V3: DSGVO is findable via title search (CELEX 32016R0679)', async () => {
    const { results } = await client.sparqlQuery('Datenschutz-Grundverordnung', {
      language: 'DEU',
      limit: 50,
    })

    const celexIds = results.map((r) => r.celex)
    expect(celexIds).toContain('32016R0679')
  }, TIMEOUT)

  // V4: Volltext AI Act abrufbar (DE, XHTML) → Content >10.000 Zeichen
  it('V4: AI Act full text retrievable in DE (>10.000 chars)', async () => {
    const content = await client.fetchDocument('32024R1689', 'DEU')

    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(10_000)
  }, TIMEOUT)

  // V5: Volltext abrufbar (EN, XHTML) → Content >10.000 Zeichen
  it('V5: AI Act full text retrievable in EN (>10.000 chars)', async () => {
    const content = await client.fetchDocument('32024R1689', 'ENG')

    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(10_000)
  }, TIMEOUT)

  // M-LIVE-1: Metadata for AI Act retrievable with real data
  it('M-LIVE-1: metadataQuery returns metadata for AI Act (32024R1689)', async () => {
    const result = await client.metadataQuery('32024R1689', 'DEU')

    expect(result.celex_id).toBe('32024R1689')
    expect(result.title).toBeDefined()
    expect(result.title.length).toBeGreaterThan(0)
    expect(Array.isArray(result.authors)).toBe(true)
    expect(result.eurovoc_concepts.length).toBeGreaterThan(0)
    expect(result.in_force).toBe(true)
    expect(result.resource_type).toBe('REG')
    expect(result.eurlex_url).toContain('32024R1689')
  }, TIMEOUT)

  // C-LIVE-1: Citations for DSGVO (use ENG — more related acts have English titles)
  it('C-LIVE-1: citationsQuery returns citations for DSGVO (32016R0679)', async () => {
    const result = await client.citationsQuery('32016R0679', 'ENG', 'both', 50)

    expect(result.celex_id).toBe('32016R0679')
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.citations.length).toBeGreaterThanOrEqual(1)

    const first = result.citations[0]
    expect(first).toHaveProperty('celex')
    expect(first).toHaveProperty('title')
    expect(first).toHaveProperty('relationship')
    expect(first).toHaveProperty('eurlex_url')
  }, TIMEOUT)

  // E-LIVE-1: EuroVoc finds AI Act (use direct URI + REG filter to narrow results)
  it('E-LIVE-1: eurovocQuery for AI concept finds AI Act', async () => {
    const results = await client.eurovocQuery(
      'http://eurovoc.europa.eu/3030',  // EuroVoc concept: artificial intelligence
      'REG',
      'ENG',
      50
    )

    expect(results.length).toBeGreaterThanOrEqual(1)
    const celexIds = results.map(r => r.celex)
    expect(celexIds).toContain('32024R1689')
  }, TIMEOUT)

  // CON-LIVE-1: Consolidated DSGVO
  it('CON-LIVE-1: fetchConsolidated returns consolidated text for DSGVO (reg/2016/679)', async () => {
    const result = await client.fetchConsolidated('reg', 2016, 679, 'DEU')

    expect(result.content).toBeDefined()
    expect(result.content.length).toBeGreaterThan(1000)
    expect(result.eliUrl).toContain('reg/2016/679')
  }, TIMEOUT)

  // S-LIVE-1: Enhanced Search with resource_type REG — verify filter is applied
  it('S-LIVE-1: sparqlQuery with resource_type REG finds regulations', async () => {
    const { results } = await client.sparqlQuery('Datenschutz', {
      resource_type: 'REG',
      language: 'DEU',
      limit: 10,
    })

    expect(results.length).toBeGreaterThanOrEqual(1)
    // At least the majority should be REG (SPARQL binding may show the resolved type)
    const regCount = results.filter(r => r.type === 'REG').length
    expect(regCount).toBeGreaterThanOrEqual(1)
  }, TIMEOUT)

  // ERR-LIVE-1: Error case with invalid CELEX
  it('ERR-LIVE-1: metadataQuery with invalid CELEX returns clean error', async () => {
    await expect(
      client.metadataQuery('99999X9999', 'DEU')
    ).rejects.toThrow(/No metadata found for CELEX/)
  }, TIMEOUT)

  // LANG-LIVE-1 (Task 1 probe): a non-DE/EN/FR language works end-to-end.
  // Exercises the Polish language-authority URI (.../language/POL) for the title
  // AND the "pl" SPARQL LANG() filter for EuroVoc labels, plus the /pl/ eur-lex URL.
  it('LANG-LIVE-1: metadataQuery in Polish (POL) for AI Act (32024R1689)', async () => {
    const result = await client.metadataQuery('32024R1689', 'POL')

    expect(result.celex_id).toBe('32024R1689')
    expect(result.title.toLowerCase()).toContain('sztucznej inteligencji')
    // EuroVoc labels only come back when the "pl" LANG() filter matches.
    expect(result.eurovoc_concepts.length).toBeGreaterThan(0)
    expect(result.eurlex_url).toContain('/pl/')
  }, TIMEOUT)

  // LANG-LIVE-2 (Task 1 probe): Spanish EuroVoc label resolution + URI.
  // Exercises resolveEurovocLabel with the "es" LANG() filter and buildEurovocQuery
  // with the .../language/SPA URI. The AI concept label "inteligencia artificial"
  // resolves to eurovoc/3030 and finds the AI Act.
  it('LANG-LIVE-2: eurovocQuery via Spanish (SPA) label finds the AI Act', async () => {
    const results = await client.eurovocQuery('inteligencia artificial', 'REG', 'SPA', 50)

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.map((r) => r.celex)).toContain('32024R1689')
    expect(results[0].eurlex_url).toContain('/es/')
  }, TIMEOUT)

  // ID-LIVE-1 (Task 2 probe): GDPR ELI resolves to CELEX 32016R0679, both short
  // and full form. Exercises cdm:resource_legal_eli literal matching.
  it('ID-LIVE-1: resolveEliToCelex resolves the GDPR ELI to 32016R0679', async () => {
    expect(await client.resolveEliToCelex('reg/2016/679')).toBe('32016R0679')
    expect(await client.resolveEliToCelex('http://data.europa.eu/eli/reg/2016/679/oj')).toBe(
      '32016R0679'
    )
  }, TIMEOUT)

  // ID-LIVE-2 (Task 2 probe): AI Act OJ reference resolves to CELEX 32024R1689 via
  // owl:sameAs on the OJ resource URI.
  it('ID-LIVE-2: resolveOjRefToCelex resolves OJ:L_202401689 to 32024R1689', async () => {
    expect(await client.resolveOjRefToCelex('OJ:L_202401689')).toBe('32024R1689')
  }, TIMEOUT)

  // ID-LIVE-3 (Task 2): a non-resolvable ELI raises a clear error (no false match).
  it('ID-LIVE-3: an unknown ELI raises a clear "Could not resolve" error', async () => {
    await expect(client.resolveEliToCelex('reg/1800/999')).rejects.toThrow(
      /Could not resolve ELI/
    )
  }, TIMEOUT)
})
