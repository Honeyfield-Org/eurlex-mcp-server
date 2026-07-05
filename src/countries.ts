import { z } from 'zod';

/**
 * The 27 EU member states — the single source of truth for national
 * transposition (NIM) country handling. Each entry pairs the code used in two
 * deliberately different places:
 *
 * - `alpha2` (e.g. "DE", "AT") is the input code accepted by the
 *   `eurlex_transposition` tool's `country` filter (see COUNTRY_ENUM). It is
 *   the EU institutional 2-letter code list, which is ISO 3166-1 alpha-2 for
 *   every member state EXCEPT Greece, where the EU uses "EL" (ISO would be
 *   "GR"). Documented here because it is the one non-ISO code in the set.
 *
 * - `alpha3` (e.g. "DEU", "AUT") is the ISO 3166-1 alpha-3 code that is the
 *   last segment of the CDM country-authority URI,
 *   `.../resource/authority/country/{alpha3}` — live-verified 2026-07-05 that
 *   NIMs carry e.g. `.../country/DEU`, `.../country/GRC`. It is what the SPARQL
 *   country filter embeds and what a NIM's CELEX encodes
 *   (`72022L2555DEU_...`).
 *
 * The country authority table exposes no 2-letter label, so the alpha2↔alpha3
 * mapping must live here.
 */
export interface EuMemberState {
  /** EU institutional 2-letter code (ISO 3166-1 alpha-2, except "EL" for Greece). */
  readonly alpha2: string;
  /** ISO 3166-1 alpha-3 code; the CDM country-authority URI suffix. */
  readonly alpha3: string;
}

export const EU_MEMBER_STATES = [
  { alpha2: 'AT', alpha3: 'AUT' },
  { alpha2: 'BE', alpha3: 'BEL' },
  { alpha2: 'BG', alpha3: 'BGR' },
  { alpha2: 'HR', alpha3: 'HRV' },
  { alpha2: 'CY', alpha3: 'CYP' },
  { alpha2: 'CZ', alpha3: 'CZE' },
  { alpha2: 'DK', alpha3: 'DNK' },
  { alpha2: 'EE', alpha3: 'EST' },
  { alpha2: 'FI', alpha3: 'FIN' },
  { alpha2: 'FR', alpha3: 'FRA' },
  { alpha2: 'DE', alpha3: 'DEU' },
  { alpha2: 'EL', alpha3: 'GRC' },
  { alpha2: 'HU', alpha3: 'HUN' },
  { alpha2: 'IE', alpha3: 'IRL' },
  { alpha2: 'IT', alpha3: 'ITA' },
  { alpha2: 'LV', alpha3: 'LVA' },
  { alpha2: 'LT', alpha3: 'LTU' },
  { alpha2: 'LU', alpha3: 'LUX' },
  { alpha2: 'MT', alpha3: 'MLT' },
  { alpha2: 'NL', alpha3: 'NLD' },
  { alpha2: 'PL', alpha3: 'POL' },
  { alpha2: 'PT', alpha3: 'PRT' },
  { alpha2: 'RO', alpha3: 'ROU' },
  { alpha2: 'SK', alpha3: 'SVK' },
  { alpha2: 'SI', alpha3: 'SVN' },
  { alpha2: 'ES', alpha3: 'ESP' },
  { alpha2: 'SE', alpha3: 'SWE' },
] as const satisfies readonly EuMemberState[];

/** Union of the 27 valid 2-letter member-state codes, e.g. "DE" | "AT" | … */
export type MemberStateCode = (typeof EU_MEMBER_STATES)[number]['alpha2'];

/**
 * The 27 alpha-2 codes as a tuple, for `z.enum`. The `as` narrows the widened
 * `MemberStateCode[]` from `.map` back to the non-empty tuple `z.enum` requires;
 * a tuple is a subtype of the array, so this is a safe narrowing assertion.
 */
export const MEMBER_STATE_CODES = EU_MEMBER_STATES.map((m) => m.alpha2) as [
  MemberStateCode,
  ...MemberStateCode[],
];

/** Zod enum of the 27 member-state 2-letter codes, for the transposition schema. */
export const COUNTRY_ENUM = z.enum(MEMBER_STATE_CODES);

/**
 * alpha-2 → alpha-3: maps the tool's `country` input to the CDM
 * country-authority URI suffix embedded in the SPARQL filter.
 */
export const MS_ALPHA2_TO_ALPHA3: Record<string, string> = Object.fromEntries(
  EU_MEMBER_STATES.map((m) => [m.alpha2, m.alpha3]),
);

/**
 * alpha-3 → alpha-2: maps the country code returned by SPARQL (the authority
 * URI suffix, always alpha-3) back to the friendly 2-letter code for output.
 * A code with no entry (e.g. "GBR" on pre-Brexit directives like 31995L0046)
 * has no member-state alpha-2, so callers fall back to the raw alpha-3.
 */
export const MS_ALPHA3_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  EU_MEMBER_STATES.map((m) => [m.alpha3, m.alpha2]),
);
