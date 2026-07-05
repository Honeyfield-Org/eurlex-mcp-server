import { describe, it, expect } from 'vitest'
import { scrubSparql, validateAndPrepareSparql } from '../src/tools/sparql.js'

// A minimal, well-formed SELECT used as the base for the LIMIT tests.
const SELECT = 'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\nSELECT ?s WHERE { ?s ?p ?o }'

describe('scrubSparql()', () => {
  it('SC1 – removes double-quoted string literals', () => {
    expect(scrubSparql('FILTER(CONTAINS(?t, "hello world"))')).not.toContain('hello world')
  })

  it('SC2 – removes single-quoted and triple-quoted string literals', () => {
    expect(scrubSparql("?s ?p 'inside single'")).not.toContain('inside single')
    expect(scrubSparql('?s ?p """triple quoted"""')).not.toContain('triple quoted')
  })

  it('SC3 – removes line comments (# to end of line)', () => {
    expect(scrubSparql('SELECT ?s # this is a comment\nWHERE {}')).not.toContain('this is a comment')
  })

  it('SC4 – does NOT treat "#" inside an IRI as a comment (keeps later text intact)', () => {
    // The cdm# fragment must not swallow the rest of the line — otherwise a
    // keyword after a prefix IRI would go undetected (under-block).
    const scrubbed = scrubSparql(
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT ?s WHERE {}',
    )
    expect(scrubbed).toContain('SELECT')
    expect(scrubbed).toContain('WHERE')
  })

  it('SC5 – does NOT treat the "<" comparison operator as an IRI', () => {
    // "?d < ?e" must not be consumed as an IRIREF (no ">" reachable), so text
    // after it survives.
    const scrubbed = scrubSparql('FILTER(?d < ?e) SELECT_MARKER')
    expect(scrubbed).toContain('SELECT_MARKER')
  })

  it('SC6 – a PN_LOCAL_ESC backslash-escape cannot open a comment that swallows later text', () => {
    // `ex:a\#b` is a prefixed local name with a PN_LOCAL_ESC (`\#`). The escaped
    // "#" must NOT be read as a line comment — otherwise the rest of the line
    // (a live SERVICE) would be scrubbed away and go undetected (under-block).
    const scrubbed = scrubSparql('?s ex:a\\#b SERVICE_MARKER <http://evil/s>')
    expect(scrubbed).toContain('SERVICE_MARKER')
  })

  it('SC7 – a PN_LOCAL_ESC backslash-escape cannot open a string that swallows later text', () => {
    // `ex:a\'` — the escaped single quote must not open a string that runs to a
    // later real quote, swallowing a live SERVICE in between.
    const scrubbed = scrubSparql("?s ex:a\\' SERVICE_MARKER 'closes here'")
    expect(scrubbed).toContain('SERVICE_MARKER')
  })
})

describe('validateAndPrepareSparql() – accepted forms', () => {
  it('VA1 – accepts a SELECT and appends the default LIMIT when none is present', () => {
    const { query, limitAdded } = validateAndPrepareSparql(SELECT)
    expect(limitAdded).toBe(true)
    expect(query).toMatch(/LIMIT 50\s*$/)
  })

  it('VA2 – accepts an ASK and does NOT append a LIMIT (ASK takes none)', () => {
    const { query, limitAdded } = validateAndPrepareSparql('ASK { ?s ?p ?o }')
    expect(limitAdded).toBe(false)
    expect(query).not.toMatch(/LIMIT/i)
  })

  it('VA3 – accepts a SELECT whose keyword-looking words live only in a string literal', () => {
    // Over-blocking a keyword inside a string would be *acceptable* per the brief,
    // but the whole point of scrubbing is to NOT do that — verify it is allowed.
    const q = 'SELECT ?s WHERE { ?s rdfs:label "please DELETE and DROP this" } LIMIT 5'
    expect(() => validateAndPrepareSparql(q)).not.toThrow()
  })

  it('VA4 – accepts a SELECT with a forbidden word only inside a comment', () => {
    const q = 'SELECT ?s WHERE { ?s ?p ?o } # TODO: SERVICE federation later\nLIMIT 5'
    expect(() => validateAndPrepareSparql(q)).not.toThrow()
  })
})

describe('validateAndPrepareSparql() – forbidden keyword reject matrix', () => {
  const cases: [string, string][] = [
    ['INSERT', 'INSERT DATA { <a> <b> <c> }'],
    ['DELETE', 'DELETE WHERE { ?s ?p ?o }'],
    ['LOAD', 'LOAD <http://example.org/data>'],
    ['CLEAR', 'CLEAR GRAPH <http://example.org/g>'],
    ['CREATE', 'CREATE GRAPH <http://example.org/g>'],
    ['DROP', 'DROP GRAPH <http://example.org/g>'],
    ['COPY', 'COPY <http://example.org/a> TO <http://example.org/b>'],
    ['MOVE', 'MOVE <http://example.org/a> TO <http://example.org/b>'],
    ['ADD', 'ADD <http://example.org/a> TO <http://example.org/b>'],
    ['SERVICE', 'SELECT ?s WHERE { SERVICE <http://evil.example/sparql> { ?s ?p ?o } }'],
  ]

  for (const [keyword, query] of cases) {
    it(`RJ-${keyword} – rejects a query containing an active ${keyword}`, () => {
      expect(() => validateAndPrepareSparql(query)).toThrow(new RegExp(keyword))
    })
  }

  it('RJ-case – keyword matching is case-insensitive', () => {
    expect(() => validateAndPrepareSparql('select ?s where { service <x> { ?s ?p ?o } }')).toThrow(
      /SERVICE/,
    )
  })

  it('RJ-under-block – a SERVICE after a prefix IRI (with "#") is still caught', () => {
    // Guards against the IRI-"#" bug: if the cdm# fragment were treated as a
    // comment, everything after it (including SERVICE) would be missed.
    const q =
      'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n' +
      'SELECT ?s WHERE { SERVICE <http://evil.example/s> { ?s ?p ?o } }'
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })

  it('RJ-under-block-2 – a SERVICE after a closed string literal is still caught', () => {
    const q = 'SELECT ?s WHERE { ?s rdfs:label "done" . SERVICE <http://evil/s> { ?s ?p ?o } }'
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })
})

describe('validateAndPrepareSparql() – PN_LOCAL_ESC scrubber-bypass guard', () => {
  // SPARQL's PN_LOCAL_ESC production allows a backslash to escape one of
  //   _ ~ . - ! $ & ' ( ) * + , ; = / ? # @ %
  // inside a prefixed local name (e.g. `ex:a\#b`). Left unmodelled, that stray
  // backslash lets the following char (`#`, `'`, `"`, …) open a comment/string
  // that swallows a live SERVICE clause — an under-block that ships the forbidden
  // query to the endpoint. Each case below must be REJECTED (SERVICE detected).

  it('RJ-esc-hash – escaped "#" in a local name must not hide a trailing SERVICE', () => {
    const q =
      'PREFIX ex: <http://example.org/> ' +
      'SELECT ?s WHERE { ?s ex:a\\#b ?o . SERVICE <http://evil.example/sparql> { ?s ?p ?o } }'
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })

  it('RJ-esc-quote – escaped "\'" closed by a later real string must not hide SERVICE', () => {
    const q =
      'PREFIX ex: <http://example.org/> ' +
      "SELECT ?s WHERE { ?s ex:a\\' SERVICE <http://evil/s> 'x' ?o }"
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })

  it('RJ-esc-dquote – a backslash before a double-quote outside a string must not hide SERVICE', () => {
    const q =
      'PREFIX ex: <http://example.org/> ' +
      'SELECT ?s WHERE { ?s ex:a\\"done SERVICE <http://evil/s> stuff" ?o }'
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })

  it('RJ-esc-percent – escaped "%" variant with a SERVICE is still rejected', () => {
    const q =
      'PREFIX ex: <http://example.org/> ' +
      'SELECT ?s WHERE { ?s ex:a\\%b ?o . SERVICE <http://evil/s> { ?s ?p ?o } }'
    expect(() => validateAndPrepareSparql(q)).toThrow(/SERVICE/)
  })

  it('RJ-esc-legit – a legit PN_LOCAL_ESC query with NO forbidden keyword is accepted', () => {
    // Documented behavior: PASS. Scrubbing the `\.` to a space splits the local
    // name in the DETECTION copy only; the ORIGINAL query is what gets sent, so
    // execution is unaffected. (Over-block would also be acceptable per the brief,
    // but here it passes.)
    const q = 'SELECT ?s WHERE { ?s ex:foo\\.bar ?o }'
    expect(() => validateAndPrepareSparql(q)).not.toThrow()
    const { limitAdded } = validateAndPrepareSparql(q)
    expect(limitAdded).toBe(true)
  })
})

describe('validateAndPrepareSparql() – only SELECT/ASK', () => {
  it('FM1 – rejects CONSTRUCT', () => {
    expect(() => validateAndPrepareSparql('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toThrow(
      /SELECT or ASK/,
    )
  })

  it('FM2 – rejects DESCRIBE', () => {
    expect(() => validateAndPrepareSparql('DESCRIBE <http://example.org/x>')).toThrow(
      /SELECT or ASK/,
    )
  })

  it('FM3 – rejects a query with no query form at all', () => {
    expect(() =>
      validateAndPrepareSparql('PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>'),
    ).toThrow(/SELECT or ASK/)
  })
})

describe('validateAndPrepareSparql() – LIMIT policy', () => {
  it('LP1 – leaves an existing in-range top-level LIMIT untouched', () => {
    const { query, limitAdded } = validateAndPrepareSparql(`${SELECT} LIMIT 25`)
    expect(limitAdded).toBe(false)
    expect(query).toMatch(/LIMIT 25\s*$/)
    // No second LIMIT appended.
    expect(query.match(/LIMIT/gi)).toHaveLength(1)
  })

  it('LP2 – accepts LIMIT exactly at the maximum (100)', () => {
    expect(() => validateAndPrepareSparql(`${SELECT} LIMIT 100`)).not.toThrow()
  })

  it('LP3 – rejects a top-level LIMIT above the maximum', () => {
    expect(() => validateAndPrepareSparql(`${SELECT} LIMIT 101`)).toThrow(/exceeds the maximum/)
    expect(() => validateAndPrepareSparql(`${SELECT} LIMIT 5000`)).toThrow(/exceeds the maximum/)
  })

  it('LP4 – case-insensitive LIMIT detection (lowercase "limit")', () => {
    const { limitAdded } = validateAndPrepareSparql(`${SELECT} limit 30`)
    expect(limitAdded).toBe(false)
  })

  it('LP5 – a LIMIT that lives only in a SUBQUERY is not the top-level LIMIT → default appended', () => {
    const q = 'SELECT ?s WHERE { { SELECT ?s WHERE { ?s ?p ?o } LIMIT 10 } }'
    const { query, limitAdded } = validateAndPrepareSparql(q)
    expect(limitAdded).toBe(true)
    // Subquery LIMIT 10 preserved AND an outer LIMIT 50 appended.
    expect(query).toContain('LIMIT 10')
    expect(query).toMatch(/LIMIT 50\s*$/)
  })

  it('LP6 – a large SUBQUERY LIMIT does not trip the > max rejection (only top-level counts)', () => {
    // Documented trade-off: the depth-based check only enforces the OUTER LIMIT.
    const q = 'SELECT ?s WHERE { { SELECT ?s WHERE { ?s ?p ?o } LIMIT 500 } } LIMIT 50'
    expect(() => validateAndPrepareSparql(q)).not.toThrow()
  })
})
