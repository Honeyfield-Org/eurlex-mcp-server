/**
 * Live Cellar checks for issue #48 (entry into force vs application dates).
 * Hits the real SPARQL endpoint and the REST notice endpoint. No mocks.
 */
import { CellarClient } from '../../src/services/cellarClient.js'
import { handleEurlexMetadata } from '../../src/tools/metadata.js'
import type { MetadataResult } from '../../src/types.js'

const TIMEOUT = 90_000
const client = new CellarClient()

async function metadata(celex: string): Promise<MetadataResult> {
  const result = await handleEurlexMetadata({ celex_id: celex, language: 'ENG' })
  if (result.isError) throw new Error(result.content[0].text)
  return result.structuredContent as MetadataResult
}

describe('Issue #48 – effect dates (live)', () => {
  it('GDPR 32016R0679: entry into force 2016-05-24, application 2018-05-25', async () => {
    const r = await metadata('32016R0679')
    expect(r.date_entry_into_force).toBe('2016-05-24')
    expect(r.date_application).toBe('2018-05-25')
    expect(r.dates_effect).toEqual([
      { date: '2016-05-24', type: 'entry_into_force', note: 'Date pub. +20 See Art 99' },
      { date: '2018-05-25', type: 'application', note: 'See Art 99' },
    ])
  }, TIMEOUT)

  it('DSA 32022R2065: entry into force 2022-11-16 despite the earlier (mistyped) application date', async () => {
    const r = await metadata('32022R2065')
    expect(r.date_entry_into_force).toBe('2022-11-16')
    expect(r.date_application).toBe('2022-02-17') // Cellar data error, reported as held
    expect(r.dates_effect.map((d) => `${d.date} ${d.type}`)).toEqual([
      '2022-02-17 application',
      '2022-11-16 entry_into_force',
      '2022-11-16 partial_application',
    ])
  }, TIMEOUT)

  it('AI Act 32024R1689: general application 2026-08-02, three partial application dates', async () => {
    const r = await metadata('32024R1689')
    expect(r.date_entry_into_force).toBe('2024-08-01')
    expect(r.date_application).toBe('2026-08-02')
    expect(r.dates_effect.filter((d) => d.type === 'partial_application').map((d) => d.date)).toEqual([
      '2025-02-02',
      '2025-08-02',
      '2027-08-02',
    ])
  }, TIMEOUT)

  it('NIS2 32022L2555: single date, no application date', async () => {
    const r = await metadata('32022L2555')
    expect(r.date_entry_into_force).toBe('2023-01-16')
    expect(r.date_application).toBeNull()
    expect(r.dates_effect).toHaveLength(1)
  }, TIMEOUT)

  it('SPARQL alone yields one row with every date and intact arrays (GDPR)', async () => {
    const r = await client.metadataQuery('32016R0679', 'ENG')
    expect(r.dates_effect.map((d) => d.date)).toEqual(['2016-05-24', '2018-05-25'])
    expect(r.date_entry_into_force).toBe('2016-05-24')
    expect(r.authors.length).toBeGreaterThan(0)
    expect(r.eurovoc_concepts.length).toBeGreaterThan(0)
    expect(r.legal_basis.length).toBeGreaterThan(0)
  }, TIMEOUT)

  it('CJEU judgment 62021CJ0180: no entry-into-force date → null and empty dates_effect', async () => {
    const r = await metadata('62021CJ0180')
    expect(r.date_entry_into_force).toBeNull()
    expect(r.date_application).toBeNull()
    expect(r.dates_effect).toEqual([])
    expect(r.title.length).toBeGreaterThan(0)
  }, TIMEOUT)

  it('CJEU judgment 62021CJ0180: authors name the Advocate General, no raw cellar UUID (#52)', async () => {
    const r = await metadata('62021CJ0180')
    expect(r.authors).toContain('Campos Sánchez-Bordona')
    expect(r.authors.some((a) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(a))).toBe(false)
  }, TIMEOUT)
})
