import type { EffectDate, MetadataResult } from '../types.js';

/**
 * Pure helpers for the entry-into-force / application dates of an act.
 *
 * Cellar stores every "date of effect" of an act under the single property
 * cdm:resource_legal_date_entry-into-force (e.g. GDPR: 2016-05-24 entry into
 * force AND 2018-05-25 application). SPARQL exposes the values but not their
 * type; the type lives only in the REST notice (see cellarNotice.ts).
 */

/**
 * Picks the entry-into-force date from the untyped SPARQL values: the earliest
 * date that is not before the document date. Dates before the document date
 * cannot be an entry into force (an act cannot enter into force before it is
 * adopted) — this also sidesteps Cellar data errors such as the DSA's
 * 2022-02-17 (a mistyped 2024-02-17). Falls back to the earliest date when no
 * date passes the check, and to null when there are no dates at all.
 *
 * ISO dates (YYYY-MM-DD) compare correctly as strings.
 */
export function selectEntryIntoForce(dates: string[], dateDocument: string | null): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const candidates = dateDocument === null ? sorted : sorted.filter((d) => d >= dateDocument);
  return candidates[0] ?? sorted[0];
}

/**
 * Upgrades a SPARQL-derived metadata result with the typed dates from the
 * Cellar notice. Without typed dates (notice unavailable, or no blocks) the
 * base result is returned as-is, so callers always get the heuristic answer at
 * minimum. `typed` is expected in the parser's order (ascending by date, entry
 * into force first), so the first match of each type is the earliest.
 */
export function mergeEffectDates(base: MetadataResult, typed: EffectDate[] | null): MetadataResult {
  if (typed === null || typed.length === 0) return base;
  const entryIntoForce = typed.find((d) => d.type === 'entry_into_force');
  const application = typed.find((d) => d.type === 'application');
  return {
    ...base,
    date_entry_into_force: entryIntoForce?.date ?? base.date_entry_into_force,
    date_application: application?.date ?? null,
    dates_effect: typed.map((d) => ({ ...d })),
  };
}
