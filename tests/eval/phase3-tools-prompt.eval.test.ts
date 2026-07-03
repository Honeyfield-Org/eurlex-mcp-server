import { describe, it, expect } from 'vitest'
import { searchSchema } from '../../src/schemas/searchSchema.js'
import { fetchSchema } from '../../src/schemas/fetchSchema.js'
import { handleEurlexSearch, registerSearchTool } from '../../src/tools/search.js'
import { handleEurlexFetch, registerFetchTool } from '../../src/tools/fetch.js'
import { registerGuidePrompt } from '../../src/prompts/guide.js'

// ===========================================================================
// Phase 3 Eval – Tools + Prompt
// PRD milestone: "pnpm test komplett grün (Tests 1-20 + V21)"
// ===========================================================================
describe('Phase 3 Eval – Tools + Prompt', () => {
  // -------------------------------------------------------------------------
  // searchSchema validation
  // -------------------------------------------------------------------------
  describe('searchSchema', () => {
    it('accepts valid input with all fields', () => {
      const result = searchSchema.parse({
        query: 'test query',
        resource_type: 'REG',
        language: 'DEU',
        limit: 10,
      })

      expect(result.query).toBe('test query')
      expect(result.resource_type).toBe('REG')
      expect(result.language).toBe('DEU')
      expect(result.limit).toBe(10)
    })

    it('rejects query shorter than 3 chars', () => {
      expect(() =>
        searchSchema.parse({
          query: 'ab',
          resource_type: 'REG',
          language: 'DEU',
          limit: 10,
        })
      ).toThrow()
    })

    it('rejects invalid resource_type', () => {
      expect(() =>
        searchSchema.parse({
          query: 'test query',
          resource_type: 'INVALID',
          language: 'DEU',
          limit: 10,
        })
      ).toThrow()
    })

    it('accepts optional date_from and date_to in YYYY-MM-DD format', () => {
      const result = searchSchema.parse({
        query: 'test query',
        resource_type: 'REG',
        language: 'DEU',
        limit: 10,
        date_from: '2024-01-01',
        date_to: '2024-12-31',
      })

      expect(result.date_from).toBe('2024-01-01')
      expect(result.date_to).toBe('2024-12-31')
    })

    it('rejects invalid date format', () => {
      expect(() =>
        searchSchema.parse({
          query: 'test query',
          resource_type: 'REG',
          language: 'DEU',
          limit: 10,
          date_from: '01-01-2024',
        })
      ).toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // fetchSchema validation
  // -------------------------------------------------------------------------
  describe('fetchSchema', () => {
    it('accepts valid input with all fields', () => {
      const result = fetchSchema.parse({
        celex_id: '32024R1689',
        language: 'DEU',
        format: 'xhtml',
        max_chars: 20000,
      })

      expect(result.celex_id).toBe('32024R1689')
      expect(result.language).toBe('DEU')
      expect(result.format).toBe('xhtml')
      expect(result.max_chars).toBe(20000)
    })

    it('rejects invalid CELEX-ID', () => {
      expect(() =>
        fetchSchema.parse({
          celex_id: 'INVALID!!!',
          language: 'DEU',
          format: 'xhtml',
          max_chars: 20000,
        })
      ).toThrow()
    })

    it('rejects max_chars < 1000', () => {
      expect(() =>
        fetchSchema.parse({
          celex_id: '32024R1689',
          language: 'DEU',
          format: 'xhtml',
          max_chars: 500,
        })
      ).toThrow()
    })

    it('rejects max_chars > 50000', () => {
      expect(() =>
        fetchSchema.parse({
          celex_id: '32024R1689',
          language: 'DEU',
          format: 'xhtml',
          max_chars: 60000,
        })
      ).toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Exports existence checks
  // -------------------------------------------------------------------------
  describe('exports', () => {
    it('handleEurlexSearch is exported from src/tools/search.ts', () => {
      expect(typeof handleEurlexSearch).toBe('function')
    })

    it('handleEurlexFetch is exported from src/tools/fetch.ts', () => {
      expect(typeof handleEurlexFetch).toBe('function')
    })

    it('registerSearchTool is exported from src/tools/search.ts', () => {
      expect(typeof registerSearchTool).toBe('function')
    })

    it('registerFetchTool is exported from src/tools/fetch.ts', () => {
      expect(typeof registerFetchTool).toBe('function')
    })

    it('registerGuidePrompt is exported from src/prompts/guide.ts', () => {
      expect(typeof registerGuidePrompt).toBe('function')
    })
  })

  // -------------------------------------------------------------------------
  // eurlex_guide prompt content
  // -------------------------------------------------------------------------
  describe('eurlex_guide prompt content', () => {
    it('contains key sections: CELEX, Search strategy, 32024R1689', async () => {
      // Use a mock server to capture the prompt content
      let capturedCallback: (() => any) | undefined

      const mockServer = {
        prompt: (_name: string, _schema: any, callback: () => any) => {
          capturedCallback = callback
        },
      }

      registerGuidePrompt(mockServer as any)

      expect(capturedCallback).toBeDefined()
      const result = capturedCallback!()

      expect(result.messages).toHaveLength(1)
      const text = result.messages[0].content.text

      expect(text).toContain('CELEX')
      expect(text).toContain('Search strategy')
      expect(text).toContain('32024R1689')
    })
  })
})
