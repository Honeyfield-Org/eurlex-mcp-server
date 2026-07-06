import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { stripHtml, processContent, parseOutline } from '../src/utils.js'

// Abridged REAL OJ XHTML fixtures (see the provenance comment inside each file).
// GDPR separates "Article 5" with an ASCII space; the AI Act uses U+00A0 — the
// two documents together exercise both separators the parser must accept.
const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}.xhtml`, import.meta.url)), 'utf-8')

const AIACT = readFixture('aiact-32024R1689-abridged')
const GDPR = readFixture('gdpr-32016R0679-abridged')

/** Normalize U+00A0 to a space so assertions read naturally regardless of the source separator. */
const norm = (s: string) => s.replace(/\u00A0/g, ' ')

describe('parseOutline() — offset↔fetch coupling (THE invariant)', () => {
  // This is the non-negotiable proof: an outline offset, fed to the SAME slicing
  // pipeline eurlex_fetch uses (processContent(raw,'plain',…)), lands exactly on
  // the heading it names — not on a cross-reference to it.
  it('CP1 – AI Act: the "Article 5" offset makes processContent(plain) start at the Article 5 heading', () => {
    const { entries } = parseOutline(stripHtml(AIACT))
    const art5 = entries.find((e) => e.label === 'Article 5')
    expect(art5).toBeDefined()

    const fetched = processContent(AIACT, 'plain', 300, art5!.offset)
    // Begins with the heading, immediately followed by its own title.
    expect(norm(fetched.content)).toMatch(/^Article 5\s+Prohibited AI practices/)
  })

  it('CP2 – GDPR (ASCII-space separator): the "Article 5" offset lands on the Article 5 heading', () => {
    const { entries } = parseOutline(stripHtml(GDPR))
    const art5 = entries.find((e) => e.label === 'Article 5')
    expect(art5).toBeDefined()

    const fetched = processContent(GDPR, 'plain', 300, art5!.offset)
    expect(norm(fetched.content)).toMatch(/^Article 5\s+Principles relating to processing/)
  })

  it('CP3 – EVERY entry offset lands on its own label (AI Act, all heading kinds)', () => {
    const plain = stripHtml(AIACT)
    const { entries } = parseOutline(plain)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      // slice() on the processed text == processContent(...).content for a big window.
      expect(norm(plain.slice(e.offset))).toContain(e.label)
      expect(norm(plain.slice(e.offset)).startsWith(e.label)).toBe(true)
    }
  })
})

describe('parseOutline() — modern OJ structure (AI Act fixture)', () => {
  const { entries } = parseOutline(stripHtml(AIACT))
  const by = (label: string) => entries.find((e) => e.label === label)

  it('OM1 – detects chapters, a section, articles and an annex with the right levels', () => {
    expect(by('CHAPTER I')?.level).toBe(2)
    expect(by('CHAPTER II')?.level).toBe(2)
    expect(by('CHAPTER III')?.level).toBe(2)
    expect(by('SECTION 1')?.level).toBe(3)
    expect(by('Article 1')?.level).toBe(4)
    expect(by('Article 5')?.level).toBe(4)
    expect(by('Article 6')?.level).toBe(4)
    expect(by('ANNEX I')?.level).toBe(1)
  })

  it('OM2 – captures each heading’s subtitle from the following line', () => {
    expect(by('CHAPTER I')?.title).toBe('GENERAL PROVISIONS')
    expect(by('CHAPTER II')?.title).toBe('PROHIBITED AI PRACTICES')
    expect(by('Article 5')?.title).toBe('Prohibited AI practices')
    expect(by('SECTION 1')?.title).toBe('Classification of AI systems as high-risk')
  })

  it('OM3 – entries are in document order', () => {
    const labels = entries.map((e) => e.label)
    expect(labels.indexOf('CHAPTER I')).toBeLessThan(labels.indexOf('Article 5'))
    expect(labels.indexOf('Article 5')).toBeLessThan(labels.indexOf('CHAPTER III'))
    expect(labels.indexOf('CHAPTER III')).toBeLessThan(labels.indexOf('ANNEX I'))
    // Offsets strictly increase with document order.
    const offsets = entries.map((e) => e.offset)
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1])
  })
})

describe('parseOutline() — casing variant (GDPR fixture: title-case "Section 1")', () => {
  const { entries } = parseOutline(stripHtml(GDPR))
  const by = (label: string) => entries.find((e) => e.label === label)

  it('OG1 – detects a title-case "Section 1" heading (level 3) with its subtitle', () => {
    expect(by('Section 1')?.level).toBe(3)
    expect(by('Section 1')?.title).toBe('Transparency and modalities')
  })

  it('OG2 – detects CHAPTER I and articles', () => {
    expect(by('CHAPTER I')?.level).toBe(2)
    expect(by('Article 1')?.level).toBe(4)
    expect(by('Article 5')?.level).toBe(4)
  })
})

describe('parseOutline() — variant / older structure (synthetic plain text)', () => {
  it('OV1 – detects TITLE, roman/numeric CHAPTER, lowercase-French "article", an annex with no number, and a letter-suffixed article', () => {
    const plain = [
      'PART I',
      'GENERAL',
      'TITLE II',
      'Some title',
      'CHAPTER 4',
      'A chapter',
      'article 1',
      'Objet',
      'Article 12a',
      'Inserted article',
      'ANNEX',
      'The one annex',
    ].join('\n')

    const { entries } = parseOutline(plain)
    const labels = entries.map((e) => e.label)
    expect(labels).toEqual([
      'PART I',
      'TITLE II',
      'CHAPTER 4',
      'article 1',
      'Article 12a',
      'ANNEX',
    ])
    expect(entries.find((e) => e.label === 'PART I')?.level).toBe(1)
    expect(entries.find((e) => e.label === 'TITLE II')?.level).toBe(1)
    expect(entries.find((e) => e.label === 'CHAPTER 4')?.level).toBe(2)
    expect(entries.find((e) => e.label === 'Article 12a')?.level).toBe(4)
    expect(entries.find((e) => e.label === 'ANNEX')?.title).toBe('The one annex')
    // Offset lands on the label's first char (leading whitespace skipped).
    for (const e of entries) expect(plain.slice(e.offset).startsWith(e.label)).toBe(true)
  })

  it('OV1a – detects ALL-CAPS Article headings (ARTICLE and ARTIKEL)', () => {
    const plain = [
      'CHAPTER I',
      'Intro chapter',
      'ARTICLE 5',
      'The fifth article',
      'ARTIKEL 6',
      'The sixth article',
    ].join('\n')

    const { entries } = parseOutline(plain)
    const labels = entries.map((e) => e.label)
    expect(labels).toEqual(['CHAPTER I', 'ARTICLE 5', 'ARTIKEL 6'])
    expect(entries.find((e) => e.label === 'ARTICLE 5')?.level).toBe(4)
    expect(entries.find((e) => e.label === 'ARTIKEL 6')?.level).toBe(4)
    // Offset lands on the label's first char (leading whitespace skipped).
    for (const e of entries) expect(plain.slice(e.offset).startsWith(e.label)).toBe(true)
  })

  it('OV2 – tolerates leading whitespace and points the offset past it', () => {
    const plain = 'body\n   Article 7\n   Some rule'
    const { entries } = parseOutline(plain)
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('Article 7')
    expect(plain.slice(entries[0].offset).startsWith('Article 7')).toBe(true)
  })

  it('OV3 – a heading at the very end of the document has an empty title', () => {
    const { entries } = parseOutline('Some body text.\nANNEX III')
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('ANNEX III')
    expect(entries[0].title).toBe('')
  })

  it('OV4 – an over-long subtitle line is capped at 160 characters', () => {
    const long = 'x'.repeat(300)
    const { entries } = parseOutline(`Article 9\n${long}`)
    expect(entries[0].title).toHaveLength(160)
  })

  it('OV5 – a heading directly followed by another heading has an empty title', () => {
    const { entries } = parseOutline('PART I\nTITLE II\nActual title')
    expect(entries.map((e) => [e.label, e.title])).toEqual([
      ['PART I', ''],
      ['TITLE II', 'Actual title'],
    ])
  })
})

describe('parseOutline() — cross-reference disambiguation', () => {
  it('OD1 – a mid-sentence "Article 5" before the heading is ignored; only the standalone heading is an entry', () => {
    const plain = [
      'The measures referred to in Article 5 shall apply from 2026.', // cross-ref, mid-line
      'This paragraph also mentions Chapter II and Section 3 in passing.', // cross-refs
      'Article 5',
      'Prohibited AI practices',
      'Body of article five.',
    ].join('\n')

    const { entries, total } = parseOutline(plain)
    const art5s = entries.filter((e) => e.label === 'Article 5')
    expect(art5s).toHaveLength(1)
    // No cross-reference produced a Chapter/Section entry either.
    expect(entries.map((e) => e.label)).toEqual(['Article 5'])
    expect(total).toBe(1)
    // The single entry points at the heading (title follows immediately).
    expect(plain.slice(art5s[0].offset)).toMatch(/^Article 5\nProhibited AI practices/)
  })
})

describe('parseOutline() — empty / structureless documents', () => {
  it('OE1 – empty string yields an empty outline', () => {
    expect(parseOutline('')).toEqual({ entries: [], total: 0, truncated: false })
  })

  it('OE2 – prose with no headings yields an empty outline', () => {
    const plain = 'Whereas the Council considered the matter, and having regard to the Treaty,\nit was decided.'
    expect(parseOutline(plain)).toEqual({ entries: [], total: 0, truncated: false })
  })
})

describe('parseOutline() — large-document cap', () => {
  it('OL1 – caps entries at maxEntries but still reports the true total and truncated flag', () => {
    const lines: string[] = []
    for (let n = 1; n <= 305; n++) {
      lines.push(`Article ${n}`)
      lines.push(`Title of article ${n}`)
    }
    const { entries, total, truncated } = parseOutline(lines.join('\n'))
    expect(total).toBe(305)
    expect(entries).toHaveLength(300)
    expect(truncated).toBe(true)
  })

  it('OL2 – a custom maxEntries is honoured', () => {
    const plain = ['Article 1', 't1', 'Article 2', 't2', 'Article 3', 't3'].join('\n')
    const { entries, total, truncated } = parseOutline(plain, 2)
    expect(total).toBe(3)
    expect(entries).toHaveLength(2)
    expect(truncated).toBe(true)
  })
})

describe('parseOutline() — CJEU numbered paragraphs (case law)', () => {
  // In a CJEU judgment's plain text each numbered paragraph sits on its own line
  // as a bare number, surrounded by blank lines. With { numberedParagraphs: true }
  // the parser must surface these as level-4 entries; without the flag it must not.
  const plain = [
    'The Court gives the following judgment.',
    '',
    ' 49',
    '',
    'In the light of the foregoing considerations, the answer is X.',
    '',
    ' 50',
    '',
    'By its first question, the referring court asks Y.',
  ].join('\n')

  it('PP1 – with { numberedParagraphs: true } detects the numbered paragraphs', () => {
    const { entries } = parseOutline(plain, 300, { numberedParagraphs: true })
    expect(entries.map((e) => e.label)).toEqual(['Paragraph 49', 'Paragraph 50'])
    for (const e of entries) {
      expect(e.level).toBe(4)
      expect(e.title).toBe('')
    }
  })

  it('PP2 – offset coupling: the "Paragraph 49" offset lands on the number (leading space skipped)', () => {
    const { entries } = parseOutline(plain, 300, { numberedParagraphs: true })
    const p49 = entries.find((e) => e.label === 'Paragraph 49')!
    expect(plain.slice(p49.offset).startsWith('49')).toBe(true)
  })

  it('PP3 – gating: no paragraph entries when the flag is absent or false', () => {
    expect(parseOutline(plain).entries).toEqual([])
    expect(parseOutline(plain, 300, { numberedParagraphs: false }).entries).toEqual([])
  })

  it('PP4 – FP guard: a bare number NOT surrounded by blank lines is not matched', () => {
    // (a) neither neighbour blank.
    const a = parseOutline(['text before', ' 5', 'text after'].join('\n'), 300, {
      numberedParagraphs: true,
    })
    expect(a.entries).toEqual([])
    // (b) preceding line blank but following line non-blank.
    const b = parseOutline(['', ' 7', 'immediately-following body'].join('\n'), 300, {
      numberedParagraphs: true,
    })
    expect(b.entries).toEqual([])
  })

  it('PP5 – digit-count bound: a 5-digit bare-number line is not a paragraph', () => {
    const { entries } = parseOutline(['before.', '', ' 12345', '', 'after.'].join('\n'), 300, {
      numberedParagraphs: true,
    })
    expect(entries).toEqual([])
  })

  it('PP6 – word-headings still work alongside paragraphs when the flag is on', () => {
    const mixed = [
      'Article 5',
      'Prohibited AI practices',
      'Body of the fifth article.',
      '',
      ' 12',
      '',
      'A numbered paragraph body.',
    ].join('\n')
    const { entries } = parseOutline(mixed, 300, { numberedParagraphs: true })
    const art5 = entries.find((e) => e.label === 'Article 5')
    const p12 = entries.find((e) => e.label === 'Paragraph 12')
    expect(art5?.level).toBe(4)
    expect(p12).toBeDefined()
  })
})
