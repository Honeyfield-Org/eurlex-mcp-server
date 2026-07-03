import { describe, it, expect } from 'vitest'
import { stripHtml, toolError, processContent } from '../src/utils.js'

describe('stripHtml()', () => {
  it('removes script and style tags with their content', () => {
    const input = '<html><script>if (a > b) { alert("x") }</script><p>Hello</p><style>.foo { color: red }</style></html>'
    const result = stripHtml(input)
    expect(result).not.toContain('alert')
    expect(result).not.toContain('color')
    expect(result).toContain('Hello')
  })

  it('removes plain HTML tags', () => {
    const result = stripHtml('<div><p>Text</p></div>')
    expect(result).toBe('Text')
  })

  it('decodes &nbsp; and &#160; to a plain space', () => {
    const result = stripHtml('<p>Article&nbsp;1&#160;Subject</p>')
    expect(result).toBe('Article 1 Subject')
  })

  it('decodes &amp;, &lt;, &gt;, &quot;, &#39; and &apos;', () => {
    const result = stripHtml('<p>Terms &amp; Conditions: &lt;tag&gt; &quot;quoted&quot; it&#39;s &apos;fine&apos;</p>')
    expect(result).toBe(`Terms & Conditions: <tag> "quoted" it's 'fine'`)
  })

  it('does not double-decode &amp;lt; into "<"', () => {
    // &amp;lt; represents the literal text "&lt;", not "<"
    const result = stripHtml('<p>&amp;lt;</p>')
    expect(result).toBe('&lt;')
  })

  it('collapses runs of spaces and tabs into a single space', () => {
    const result = stripHtml('<p>Article   1\t\tSubject</p>')
    expect(result).toBe('Article 1 Subject')
  })

  it('trims trailing spaces at the end of each line', () => {
    const result = stripHtml('<p>Line one   </p>\n<p>Line two</p>')
    expect(result).toBe('Line one\nLine two')
  })

  it('collapses 3+ consecutive newlines to 2', () => {
    const result = stripHtml('First\n\n\n\n\nSecond')
    expect(result).toBe('First\n\nSecond')
  })

  it('leaves a single blank line (2 newlines) alone', () => {
    const result = stripHtml('First\n\nSecond')
    expect(result).toBe('First\n\nSecond')
  })

  it('collapses table-layout blank lines from a table-heavy fixture (no 3+ newline runs remain)', () => {
    // Simulates an XHTML table where most cells are empty, rendering as long runs
    // of blank lines once tags are stripped — the live-verified GDPR token-waste finding.
    const row = (cell: string) => `<tr><td>${cell}</td><td></td><td></td><td></td></tr>\n`
    const table = `<table>\n${row('Article 1')}${row('')}${row('')}${row('')}${row('Article 2')}</table>`
    const result = stripHtml(table)
    expect(result).not.toMatch(/\n{3,}/)
    expect(result).toContain('Article 1')
    expect(result).toContain('Article 2')
  })
})

describe('toolError()', () => {
  it('wraps an Error instance into MCP error response', () => {
    const result = toolError(new Error('something broke'))
    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Error: something broke')
  })

  it('wraps a string into MCP error response', () => {
    const result = toolError('raw string error')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Error: raw string error')
  })

  it('wraps a non-Error object into MCP error response', () => {
    const result = toolError(42)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Error: 42')
  })
})

describe('processContent()', () => {
  it('returns content as-is for xhtml format', () => {
    const result = processContent('<p>Hello</p>', 'xhtml', 1000)
    expect(result.content).toBe('<p>Hello</p>')
    expect(result.truncated).toBe(false)
    expect(result.total_chars).toBe(12)
    expect(result.returned_chars).toBe(12)
    expect(result.offset).toBe(0)
    expect(result.next_offset).toBeNull()
  })

  it('strips HTML for plain format before measuring/slicing', () => {
    const result = processContent('<p>Hello</p>', 'plain', 1000)
    expect(result.content).toBe('Hello')
    expect(result.total_chars).toBe(5)
    expect(result.returned_chars).toBe(5)
  })

  it('defaults offset to 0 when omitted', () => {
    const result = processContent('x'.repeat(10), 'xhtml', 5)
    expect(result.offset).toBe(0)
    expect(result.content).toBe('xxxxx')
  })

  it('slices from the start and reports next_offset when truncated', () => {
    const long = 'x'.repeat(5000)
    const result = processContent(long, 'xhtml', 1000, 0)
    expect(result.truncated).toBe(true)
    expect(result.total_chars).toBe(5000)
    expect(result.returned_chars).toBe(1000)
    expect(result.content.length).toBe(1000)
    expect(result.offset).toBe(0)
    expect(result.next_offset).toBe(1000)
  })

  it('slices a middle window using a non-zero offset', () => {
    const text = '0123456789'
    const result = processContent(text, 'xhtml', 4, 3)
    expect(result.content).toBe('3456')
    expect(result.offset).toBe(3)
    expect(result.returned_chars).toBe(4)
    expect(result.total_chars).toBe(10)
    expect(result.truncated).toBe(true)
    expect(result.next_offset).toBe(7)
  })

  it('reports truncated: false and next_offset: null on the final window', () => {
    const text = '0123456789'
    const result = processContent(text, 'xhtml', 4, 6)
    expect(result.content).toBe('6789')
    expect(result.returned_chars).toBe(4)
    expect(result.truncated).toBe(false)
    expect(result.next_offset).toBeNull()
  })

  it('returns empty content and truncated: false for an offset beyond the end', () => {
    const text = '0123456789'
    const result = processContent(text, 'xhtml', 4, 100)
    expect(result.content).toBe('')
    expect(result.returned_chars).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.next_offset).toBeNull()
    expect(result.total_chars).toBe(10)
  })

  it('strips HTML before applying the offset window (strip -> slice ordering)', () => {
    const html = '<div>' + 'x'.repeat(100) + '</div>'
    const result = processContent(html, 'plain', 50, 10)
    expect(result.total_chars).toBe(100) // length after stripping, before slicing
    expect(result.content).toBe('x'.repeat(50))
    expect(result.truncated).toBe(true)
    expect(result.next_offset).toBe(60)
  })

  it('paging through offset=0 then offset=next_offset reconstructs the full processed text', () => {
    const original = 'The quick brown fox jumps over the lazy dog. '.repeat(50)
    const maxChars = 137 // deliberately not a clean divisor of the total length

    let cursor = 0
    let reconstructed = ''
    for (let guard = 0; guard < 1000; guard++) {
      const page = processContent(original, 'xhtml', maxChars, cursor)
      reconstructed += page.content
      if (!page.truncated) break
      cursor = page.next_offset as number
    }

    expect(reconstructed).toBe(original)
  })

  it('rejects invalid format at type level', () => {
    // @ts-expect-error — 'pdf' is not assignable to 'plain' | 'xhtml'
    processContent('<p>test</p>', 'pdf', 1000)
  })
})
