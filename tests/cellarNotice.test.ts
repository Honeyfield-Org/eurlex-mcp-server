import { describe, it, expect } from 'vitest'
import { parseNoticeEffectDates } from '../src/services/cellarNotice.js'

const FD = 'http://publications.europa.eu/resource/authority/fd_335'

// Exact structure of Cellar's object/tree notice (GDPR 32016R0679), trimmed
// to the two relevant blocks. Element order and whitespace mirror the live XML.
const GDPR = `<?xml version="1.0" encoding="UTF-8"?>
<NOTICE decoding="eng" type="object">
  <WORK>
    <RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date">
      <VALUE>2018-05-25</VALUE>
      <YEAR>2018</YEAR>
      <MONTH>05</MONTH>
      <DAY>25</DAY>
      <ANNOTATION>
        <TYPE_OF_DATE>{MA|${FD}/MA}</TYPE_OF_DATE>
        <COMMENT_ON_DATE>{V|${FD}/V} {ART|${FD}/ART} 99</COMMENT_ON_DATE>
      </ANNOTATION>
    </RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
    <RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date">
      <VALUE>2016-05-24</VALUE>
      <YEAR>2016</YEAR>
      <MONTH>05</MONTH>
      <DAY>24</DAY>
      <ANNOTATION>
        <TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE>
        <COMMENT_ON_DATE>{DATPUB|${FD}/DATPUB} +20 {V|${FD}/V} {ART|${FD}/ART} 99</COMMENT_ON_DATE>
      </ANNOTATION>
    </RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
  </WORK>
</NOTICE>`

// DSA 32022R2065: one block carries TWO annotations (EV and partial MA), the
// other is the Cellar data error 2022-02-17 typed MA.
const DSA = `<NOTICE><WORK>
<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2022-11-16</VALUE><YEAR>2022</YEAR><MONTH>11</MONTH><DAY>16</DAY>
<ANNOTATION><TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE><COMMENT_ON_DATE>{DATPUB|${FD}/DATPUB} +20 {V|${FD}/V} {ART|${FD}/ART} 93.1</COMMENT_ON_DATE></ANNOTATION>
<ANNOTATION><TYPE_OF_DATE>{MA|${FD}/MA}</TYPE_OF_DATE><COMMENT_ON_DATE>{MA/PART|${FD}/MA%2FPART} {V|${FD}/V} {ART|${FD}/ART} 93.2</COMMENT_ON_DATE></ANNOTATION>
</RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2022-02-17</VALUE><YEAR>2022</YEAR><MONTH>02</MONTH><DAY>17</DAY>
<ANNOTATION><TYPE_OF_DATE>{MA|${FD}/MA}</TYPE_OF_DATE><COMMENT_ON_DATE>{V|${FD}/V} {ART|${FD}/ART} 93.2</COMMENT_ON_DATE></ANNOTATION>
</RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
</WORK></NOTICE>`

// eIDAS 32014R0910: COMMENT_ON_DATE precedes TYPE_OF_DATE and a BUILD_INFO
// element is present — element order must not matter.
const EIDAS_BLOCK = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2016-07-01</VALUE><YEAR>2016</YEAR><MONTH>07</MONTH><DAY>01</DAY>
<ANNOTATION><BUILD_INFO>cdm:CDM_2.1.7 tdm:1523 xslt:3945</BUILD_INFO><COMMENT_ON_DATE>{V|${FD}/V} {ART|${FD}/ART} 52.2</COMMENT_ON_DATE><TYPE_OF_DATE>{MA|${FD}/MA}</TYPE_OF_DATE></ANNOTATION>
</RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`

describe('parseNoticeEffectDates()', () => {
  it('types EV as entry_into_force and MA as application, sorted ascending (GDPR)', () => {
    expect(parseNoticeEffectDates(GDPR)).toEqual([
      { date: '2016-05-24', type: 'entry_into_force', note: 'Date pub. +20 See Art 99' },
      { date: '2018-05-25', type: 'application', note: 'See Art 99' },
    ])
  })

  it('emits one entry per annotation and detects partial application via the MA/PART token (DSA)', () => {
    expect(parseNoticeEffectDates(DSA)).toEqual([
      { date: '2022-02-17', type: 'application', note: 'See Art 93.2' },
      { date: '2022-11-16', type: 'entry_into_force', note: 'Date pub. +20 See Art 93.1' },
      { date: '2022-11-16', type: 'partial_application', note: 'Partial application See Art 93.2' },
    ])
  })

  it('is independent of element order and ignores BUILD_INFO (eIDAS)', () => {
    expect(parseNoticeEffectDates(EIDAS_BLOCK)).toEqual([
      { date: '2016-07-01', type: 'application', note: 'See Art 52.2' },
    ])
  })

  it('returns an unknown entry for a block without annotations', () => {
    const xml = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2023-01-16</VALUE></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    expect(parseNoticeEffectDates(xml)).toEqual([{ date: '2023-01-16', type: 'unknown', note: null }])
  })

  it('maps an unrecognised TYPE_OF_DATE code to unknown and keeps the code in the note', () => {
    const xml = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2020-01-01</VALUE><ANNOTATION><TYPE_OF_DATE>{XX|${FD}/XX}</TYPE_OF_DATE><COMMENT_ON_DATE>{ZZ|${FD}/ZZ} 5</COMMENT_ON_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    expect(parseNoticeEffectDates(xml)).toEqual([{ date: '2020-01-01', type: 'unknown', note: 'ZZ 5' }])
  })

  it('skips blocks whose VALUE is not an ISO date', () => {
    const xml = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>not-a-date</VALUE></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    expect(parseNoticeEffectDates(xml)).toEqual([])
  })

  it('decodes XML entities in the note and collapses whitespace', () => {
    const xml = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2020-01-01</VALUE><ANNOTATION><TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE><COMMENT_ON_DATE>  {V|${FD}/V}   {ART|${FD}/ART}  1 &amp; 2 </COMMENT_ON_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    expect(parseNoticeEffectDates(xml)).toEqual([{ date: '2020-01-01', type: 'entry_into_force', note: 'See Art 1 & 2' }])
  })

  it('decodes numeric entities and does not double-decode &amp;', () => {
    const xml = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2020-01-01</VALUE><ANNOTATION><TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE><COMMENT_ON_DATE>{ART|${FD}/ART} 1 &amp;lt; 2 &#39;x&#x27;</COMMENT_ON_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    const result = parseNoticeEffectDates(xml)
    expect(result).toEqual([{ date: '2020-01-01', type: 'entry_into_force', note: "Art 1 &lt; 2 'x'" }])
    expect(result[0].note).toContain('&lt;')
  })

  it('removes duplicate entries', () => {
    const block = `<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date"><VALUE>2020-01-01</VALUE><ANNOTATION><TYPE_OF_DATE>{EV|${FD}/EV}</TYPE_OF_DATE></ANNOTATION></RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>`
    expect(parseNoticeEffectDates(block + block)).toEqual([{ date: '2020-01-01', type: 'entry_into_force', note: null }])
  })

  it('returns [] for empty or unrelated input', () => {
    expect(parseNoticeEffectDates('')).toEqual([])
    expect(parseNoticeEffectDates('<NOTICE><WORK><URI><VALUE>x</VALUE></URI></WORK></NOTICE>')).toEqual([])
  })
})
