import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Read the guide source directly to test content
const guideSource = readFileSync(resolve(__dirname, '../src/prompts/guide.ts'), 'utf-8')

describe('eurlex_guide content', () => {
  it('ES7a – guide mentions eurlex_search', () => {
    expect(guideSource).toContain('eurlex_search')
  })

  it('ES7b – guide mentions eurlex_fetch', () => {
    expect(guideSource).toContain('eurlex_fetch')
  })

  it('ES7c – guide mentions eurlex_metadata', () => {
    expect(guideSource).toContain('eurlex_metadata')
  })

  it('ES7d – guide mentions eurlex_citations', () => {
    expect(guideSource).toContain('eurlex_citations')
  })

  it('ES7e – guide mentions eurlex_by_eurovoc', () => {
    expect(guideSource).toContain('eurlex_by_eurovoc')
  })

  it('ES7f – guide mentions eurlex_consolidated', () => {
    expect(guideSource).toContain('eurlex_consolidated')
  })

  it('ES8a – guide contains EuroVoc language example for ENG', () => {
    expect(guideSource).toContain('artificial intelligence')
  })

  it('ES8b – guide contains EuroVoc language example for DEU', () => {
    expect(guideSource).toContain('künstliche Intelligenz')
  })

  it('ES9 – guide contains extended resource types', () => {
    expect(guideSource).toContain('REG_IMPL')
    expect(guideSource).toContain('REG_DEL')
    expect(guideSource).toContain('DIR_IMPL')
    expect(guideSource).toContain('RECO')
  })

  it('ES10 – guide mentions eurlex_sparql and its CDM cheat sheet', () => {
    expect(guideSource).toContain('eurlex_sparql')
    expect(guideSource).toContain('CDM cheat sheet')
    // Core properties the escape hatch needs, extracted from the client.
    expect(guideSource).toContain('cdm:resource_legal_id_celex')
    expect(guideSource).toContain('cdm:expression_uses_language')
    expect(guideSource).toContain('cdm:case-law_ecli')
  })
})
