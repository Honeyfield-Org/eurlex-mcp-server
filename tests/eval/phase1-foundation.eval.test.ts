import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SPARQL_ENDPOINT,
  CELLAR_REST_BASE,
  EURLEX_BASE,
  DEFAULT_LANGUAGE,
  DEFAULT_LIMIT,
  MAX_CHARS_DEFAULT,
  MAX_CHARS_LIMIT,
  REQUEST_TIMEOUT_MS,
} from '../../src/constants.js'
import type { SparqlQueryParams, SearchResult, FetchResult } from '../../src/types.js'

const ROOT = resolve(import.meta.dirname, '../..')

describe('Phase 1 Eval – Foundation', () => {
  describe('package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))

    it('has correct name', () => {
      expect(pkg.name).toBe('eurlex-mcp-server')
    })

    it('has type: module', () => {
      expect(pkg.type).toBe('module')
    })

    it.each(['build', 'test', 'dev', 'start', 'test:integration'])(
      'has script: %s',
      (script) => {
        expect(pkg.scripts).toHaveProperty(script)
        expect(pkg.scripts[script]).toBeTruthy()
      }
    )

    it.each(['@modelcontextprotocol/sdk', 'express', 'zod'])(
      'has dependency: %s',
      (dep) => {
        expect(pkg.dependencies).toHaveProperty(dep)
      }
    )

    it.each(['vitest', 'typescript', 'tsx'])(
      'has devDependency: %s',
      (dep) => {
        expect(pkg.devDependencies).toHaveProperty(dep)
      }
    )
  })

  describe('tsconfig.json', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf-8'))

    it('exists and has strict: true', () => {
      expect(tsconfig.compilerOptions.strict).toBe(true)
    })
  })

  describe('vitest.config.ts', () => {
    it('exists', () => {
      const content = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8')
      expect(content).toContain('defineConfig')
    })
  })

  describe('constants exports', () => {
    it('exports SPARQL_ENDPOINT as a string', () => {
      expect(typeof SPARQL_ENDPOINT).toBe('string')
      expect(SPARQL_ENDPOINT).toContain('sparql')
    })

    it('exports CELLAR_REST_BASE as a string', () => {
      expect(typeof CELLAR_REST_BASE).toBe('string')
      expect(CELLAR_REST_BASE).toContain('celex')
    })

    it('exports EURLEX_BASE as a string', () => {
      expect(typeof EURLEX_BASE).toBe('string')
      expect(EURLEX_BASE).toContain('eur-lex')
    })

    it('exports DEFAULT_LANGUAGE', () => {
      expect(DEFAULT_LANGUAGE).toBe('DEU')
    })

    it('exports DEFAULT_LIMIT as a number', () => {
      expect(typeof DEFAULT_LIMIT).toBe('number')
      expect(DEFAULT_LIMIT).toBeGreaterThan(0)
    })

    it('exports MAX_CHARS_DEFAULT as a number', () => {
      expect(typeof MAX_CHARS_DEFAULT).toBe('number')
      expect(MAX_CHARS_DEFAULT).toBeGreaterThan(0)
    })

    it('exports MAX_CHARS_LIMIT as a number', () => {
      expect(typeof MAX_CHARS_LIMIT).toBe('number')
      expect(MAX_CHARS_LIMIT).toBeGreaterThanOrEqual(MAX_CHARS_DEFAULT)
    })

    it('exports REQUEST_TIMEOUT_MS as a number', () => {
      expect(typeof REQUEST_TIMEOUT_MS).toBe('number')
      expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
    })
  })

  describe('types exports', () => {
    it('SparqlQueryParams is usable as a type', () => {
      const params: SparqlQueryParams = {
        query: 'test',
        resource_type: 'REG',
        language: 'DEU',
        limit: 10,
      }
      expect(params.query).toBe('test')
    })

    it('SearchResult is usable as a type', () => {
      const result: SearchResult = {
        celex: '32020R0001',
        title: 'Test',
        date: '2020-01-01',
        type: 'REG',
        eurlex_url: 'https://example.com',
      }
      expect(result.celex).toBe('32020R0001')
    })

    it('FetchResult is usable as a type', () => {
      const result: FetchResult = {
        celex_id: '32020R0001',
        language: 'DEU',
        content: 'content',
        truncated: false,
        returned_chars: 7,
        total_chars: 7,
        offset: 0,
        next_offset: null,
        source_url: 'https://example.com',
      }
      expect(result.celex_id).toBe('32020R0001')
    })
  })
})
