import type { EffectDate, EffectDateType } from '../types.js';

/**
 * Parser for the entry-into-force / application dates in a Cellar REST notice
 * (`Accept: application/xml;notice=object`).
 *
 * Relevant structure (verified against live notices, 2026-09-04):
 *
 *   <RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE type="date">
 *     <VALUE>2016-05-24</VALUE> …
 *     <ANNOTATION>                       ← zero, one, or several per block
 *       <TYPE_OF_DATE>{EV|…/fd_335/EV}</TYPE_OF_DATE>   ← EV = entry into force, MA = application
 *       <COMMENT_ON_DATE>{DATPUB|…} +20 {V|…} {ART|…} 99</COMMENT_ON_DATE>
 *     </ANNOTATION>
 *   </RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>
 *
 * Partial application is the token `{MA/PART|…}` inside COMMENT_ON_DATE while
 * TYPE_OF_DATE stays MA. Element order inside ANNOTATION varies, and other
 * elements (BUILD_INFO) may appear. Regexes are enough for this fixed shape —
 * no XML dependency.
 */

const BLOCK_RE =
  /<RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE\b[^>]*>([\s\S]*?)<\/RESOURCE_LEGAL_DATE_ENTRY-INTO-FORCE>/g;
const VALUE_RE = /<VALUE>\s*(\d{4}-\d{2}-\d{2})\s*<\/VALUE>/;
const ANNOTATION_RE = /<ANNOTATION>([\s\S]*?)<\/ANNOTATION>/g;
const TYPE_RE = /<TYPE_OF_DATE>\s*\{([^|}]+)\|[^}]*\}\s*<\/TYPE_OF_DATE>/;
const COMMENT_RE = /<COMMENT_ON_DATE>([\s\S]*?)<\/COMMENT_ON_DATE>/;
/** `{CODE|uri}` tokens inside COMMENT_ON_DATE. */
const TOKEN_RE = /\{([^|}]+)\|[^}]*\}/g;
const PARTIAL_TOKEN = '{MA/PART|';

/** Human-readable labels for the annotation tokens, matching EUR-Lex's own wording. */
const TOKEN_LABELS: Record<string, string> = {
  DATPUB: 'Date pub.',
  V: 'See',
  ART: 'Art',
  'MA/PART': 'Partial application',
};

const TYPE_ORDER: Record<EffectDateType, number> = {
  entry_into_force: 0,
  application: 1,
  partial_application: 2,
  unknown: 3,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeComment(raw: string): string | null {
  const text = decodeEntities(raw)
    .replace(TOKEN_RE, (_match, code: string) => TOKEN_LABELS[code] ?? code)
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

function typeOf(code: string | undefined, rawComment: string): EffectDateType {
  if (code === 'EV') return 'entry_into_force';
  if (code === 'MA')
    return rawComment.includes(PARTIAL_TOKEN) ? 'partial_application' : 'application';
  return 'unknown';
}

/**
 * Extracts every effect date of the notice's work with its type, ascending by
 * date then by type (entry into force first). Returns [] when the XML holds
 * no parsable block.
 */
export function parseNoticeEffectDates(noticeXml: string): EffectDate[] {
  const seen = new Set<string>();
  const dates: EffectDate[] = [];
  const push = (entry: EffectDate): void => {
    const key = `${entry.date}|${entry.type}|${entry.note ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    dates.push(entry);
  };

  for (const block of noticeXml.matchAll(BLOCK_RE)) {
    const body = block[1];
    const date = VALUE_RE.exec(body)?.[1];
    if (!date) continue;

    const annotations = [...body.matchAll(ANNOTATION_RE)];
    if (annotations.length === 0) {
      push({ date, type: 'unknown', note: null });
      continue;
    }
    for (const annotation of annotations) {
      const inner = annotation[1];
      const rawComment = COMMENT_RE.exec(inner)?.[1] ?? '';
      push({
        date,
        type: typeOf(TYPE_RE.exec(inner)?.[1], rawComment),
        note: decodeComment(rawComment),
      });
    }
  }

  return dates.sort(
    (a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type],
  );
}
