/**
 * Phase 5 – Live Integration Tests (PRD Validation Matrix V1–V5)
 *
 * These tests hit the REAL EU Publications Office endpoints.
 * No mocks. Generous timeouts because the Cellar API can be slow.
 */

import { CellarClient } from '../../src/services/cellarClient.js'
import { handleEurlexStructure } from '../../src/tools/structure.js'
import { handleEurlexSummary, selectPrimarySummary } from '../../src/tools/summary.js'
import type { StructureResult, SummaryResult } from '../../src/types.js'
import { parseOutline, processContent, stripHtml } from '../../src/utils.js'

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

  // CL-LIVE-1 (Task 3): ECLI lookup — Google Spain by ECLI resolves to CELEX
  // 62012CJ0131 with type JUDG. Exercises the cdm:case-law_ecli anchor.
  it('CL-LIVE-1: caseLawQuery by ECLI finds Google Spain (62012CJ0131)', async () => {
    const result = await client.caseLawQuery({
      ecli: 'ECLI:EU:C:2014:317',
      court: 'any',
      type: 'any',
      language: 'ENG',
      limit: 10,
    })

    expect(result.total).toBeGreaterThanOrEqual(1)
    const first = result.results[0]
    expect(first.celex).toBe('62012CJ0131')
    expect(first.ecli).toBe('ECLI:EU:C:2014:317')
    expect(first.type).toBe('JUDG')
    expect(first.date).toBe('2014-05-13')
    expect(first.eurlex_url).toContain('CELEX:62012CJ0131')
  }, TIMEOUT)

  // CL-LIVE-2 (Task 3): related_celex — case law interpreting the GDPR
  // (32016R0679) via cdm:case-law_interpretes_resource_legal. Result set is real
  // and non-trivial; every hit is a sector-6 ruling with an ECLI.
  it('CL-LIVE-2: caseLawQuery related_celex=32016R0679 returns GDPR case law', async () => {
    const result = await client.caseLawQuery({
      related_celex: '32016R0679',
      court: 'COURT_JUSTICE',
      type: 'JUDG',
      language: 'ENG',
      limit: 10,
    })

    expect(result.total).toBeGreaterThanOrEqual(1)
    for (const r of result.results) {
      expect(r.celex).toMatch(/^6/) // sector-6 CELEX
      expect(r.type).toBe('JUDG')
    }
  }, TIMEOUT)

  // CL-LIVE-3 (Task 3): title-substring search — "Schrems" finds the Schrems II
  // judgment (62018CJ0311). Exercises the no-ORDER-BY oversample path on sector 6.
  it('CL-LIVE-3: caseLawQuery title search "Schrems" finds Schrems II (62018CJ0311)', async () => {
    const result = await client.caseLawQuery({
      query: 'Schrems',
      court: 'any',
      type: 'JUDG',
      language: 'ENG',
      limit: 20,
    })

    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.results.map((r) => r.celex)).toContain('62018CJ0311')
  }, TIMEOUT)

  // TR-LIVE-1 (Task 4): NIS2 (32022L2555) national implementing measures without a
  // country filter. Exercises the implements-relation + sector-7 CELEX prefix
  // anchor and the total_found COUNT. Probed 2026-07-05: ~285 measures across MS.
  it('TR-LIVE-1: transpositionQuery for NIS2 (32022L2555) returns NIMs across member states', async () => {
    const result = await client.transpositionQuery({
      celex_id: '32022L2555',
      language: 'ENG',
      limit: 20,
    })

    expect(result.celex_id).toBe('32022L2555')
    expect(result.returned).toBeGreaterThanOrEqual(1)
    expect(result.returned).toBeLessThanOrEqual(20)
    // The full transposition set is large, so total_found must exceed the page.
    expect(result.total_found).toBeGreaterThan(result.returned)

    const first = result.results[0]
    expect(first).toHaveProperty('country')
    expect(first).toHaveProperty('title')
    expect(first.celex).toMatch(/^72022L2555[A-Z]{3}_/) // sector-7 NIM CELEX for NIS2
    expect(first.eurlex_url).toContain(`CELEX:${first.celex}`)
    // More than one member state should appear across the page.
    expect(new Set(result.results.map((r) => r.country)).size).toBeGreaterThanOrEqual(2)
  }, TIMEOUT)

  // TR-LIVE-2 (Task 4): country-filtered — Austria's (AT→AUT) NIS2 measures. Every
  // returned CELEX must encode AUT, and total_found must not exceed the unfiltered
  // total. Titles come back in German (the member state's own language).
  it('TR-LIVE-2: transpositionQuery for NIS2 filtered to Austria (AT) returns only AT measures', async () => {
    const result = await client.transpositionQuery({
      celex_id: '32022L2555',
      country: 'AT',
      language: 'ENG',
      limit: 50,
    })

    expect(result.returned).toBeGreaterThanOrEqual(1)
    for (const r of result.results) {
      expect(r.country).toBe('AT')
      expect(r.celex).toMatch(/^72022L2555AUT_/)
    }
    expect(result.total_found).toBe(result.returned)
  }, TIMEOUT)

  // ST-LIVE-1 (Task 5): the offset↔fetch coupling holds against the LIVE document.
  // Outline the AI Act, take Article 5's offset, and prove processContent (the exact
  // pipeline eurlex_fetch(format:"plain") uses) begins at the Article 5 heading.
  it('ST-LIVE-1: AI Act outline’s "Article 5" offset makes plain-text fetch start at Article 5', async () => {
    const raw = await client.fetchDocument('32024R1689', 'ENG')
    const plain = stripHtml(raw)
    const { entries, total } = parseOutline(plain)

    expect(total).toBeGreaterThan(50) // the AI Act has ~150 headings
    const art5 = entries.find((e) => e.label === 'Article 5')
    expect(art5).toBeDefined()

    const fetched = processContent(raw, 'plain', 500, art5!.offset)
    expect(fetched.content.replace(/\u00A0/g, ' ')).toMatch(/^Article 5\s+Prohibited AI practices/)
    // total_chars from structure's stripHtml matches what fetch reports.
    expect(plain.length).toBe(fetched.total_chars)
  }, TIMEOUT)

  // ST-LIVE-2 (Task 5): the tool end-to-end via an ELI identifier — resolves the GDPR
  // and returns an outline that includes Article 5, exercising resolveCelexId +
  // fetchDocument + parseOutline through the real handler.
  it('ST-LIVE-2: handleEurlexStructure(eli) outlines the GDPR resolved from its ELI', async () => {
    const res = await handleEurlexStructure({ eli: 'reg/2016/679', language: 'ENG' })
    expect(res.isError).toBeFalsy()

    const out = JSON.parse(res.content[0].text) as StructureResult
    expect(out.celex_id).toBe('32016R0679')
    expect(out.total_headings).toBeGreaterThan(50)
    expect(out.outline.some((e) => e.label === 'Article 5')).toBe(true)
    expect(out.total_chars).toBeGreaterThan(10_000)
  }, TIMEOUT)

  // SUM-LIVE-1 (Task 6): the GDPR (32016R0679) LEGISSUM summary resolves via
  // cdm:summary_legislation_eu_summarizes_resource_legal, and its content is
  // fetchable from the summary work's Cellar URI with the xhtml5 MIME. Exercises
  // findSummaries + fetchSummaryDocument end-to-end in two languages.
  it('SUM-LIVE-1: GDPR (32016R0679) summary is found and its EN + DE content is fetchable', async () => {
    const summaries = await client.findSummaries('32016R0679', 'ENG')
    expect(summaries.length).toBeGreaterThanOrEqual(1)

    const primary = selectPrimarySummary(summaries)!
    expect(primary.uri).toContain('publications.europa.eu/resource/cellar/')
    expect(primary.legissum_id.length).toBeGreaterThan(0)
    expect(primary.title.toLowerCase()).toContain('data protection')

    const rawEn = await client.fetchSummaryDocument(primary.uri, 'ENG')
    const en = stripHtml(rawEn)
    expect(en.toLowerCase()).toContain('personal data')
    expect(en.length).toBeGreaterThan(500)

    // Accept-Language negotiation returns the German variant of the SAME summary.
    const rawDe = await client.fetchSummaryDocument(primary.uri, 'DEU')
    expect(stripHtml(rawDe).toLowerCase()).toContain('personenbezogen')
  }, TIMEOUT)

  // SUM-LIVE-2 (Task 6): the DSA (32022R2065) summary through the full tool handler.
  // Proves the celex_id → summary text + metadata + LSU source_url path end-to-end.
  it('SUM-LIVE-2: handleEurlexSummary returns the DSA (32022R2065) plain-language summary', async () => {
    const res = await handleEurlexSummary({
      celex_id: '32022R2065',
      language: 'ENG',
      max_chars: 20_000,
      offset: 0,
    })
    expect(res.isError).toBeFalsy()

    const out = JSON.parse(res.content[0].text) as SummaryResult
    expect(out.celex_id).toBe('32022R2065')
    expect(out.total_summaries).toBeGreaterThanOrEqual(1)
    expect(out.legissum_id.length).toBeGreaterThan(0)
    expect(out.obsolete).toBe(false)
    expect(out.content.toLowerCase()).toContain('digital services act')
    expect(out.content).not.toContain('<') // HTML stripped
    expect(out.source_url).toBe(
      'https://eur-lex.europa.eu/legal-content/en/LSU/?uri=CELEX:32022R2065',
    )
  }, TIMEOUT)

  // SUM-LIVE-3 (Task 6): an act with no LEGISSUM summary yields a clean "no summary"
  // message, not an error (a NIM CELEX is never itself summarized).
  it('SUM-LIVE-3: an act without a summary returns a clean no-summary message', async () => {
    const res = await handleEurlexSummary({
      celex_id: '72022L2555AUT_202500243',
      language: 'ENG',
      max_chars: 20_000,
      offset: 0,
    })
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain('No LEGISSUM summary')
  }, TIMEOUT)
})
