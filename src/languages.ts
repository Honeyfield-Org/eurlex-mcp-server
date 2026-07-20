import { z } from 'zod';

/**
 * The 24 official languages of the European Union — the single source of truth
 * for every language-dependent construct in this server.
 *
 * Each entry pairs a Cellar/CDM 3-letter language code with its ISO 639-1
 * two-letter code. The two are used in deliberately different places:
 *
 * - `code` (e.g. "DEU", "POL") is:
 *     - the last segment of the CDM language-authority URI embedded in SPARQL,
 *       `.../resource/authority/language/{code}` (live-verified: `/POL`, `/SPA`);
 *     - the value accepted by the `language` field of every tool schema
 *       (see LANGUAGE_ENUM).
 *
 * - `iso` (e.g. "de", "pl") is the BCP-47 / ISO 639-1 tag and is used in THREE
 *   distinct spots that all happen to need it — this dual/triple use is why the
 *   map below is named for the ISO tag, not for one caller (round-1 review note):
 *     1. the HTTP `Accept-Language` header for Cellar REST content negotiation;
 *     2. SPARQL `LANG(?label) = "{iso}"` filters selecting language-specific
 *        labels (EuroVoc concepts, author names, directory codes) — the language
 *        literals returned by Cellar carry exactly this tag (verified: a Polish
 *        title binding is tagged `xml:lang: "pl"`);
 *     3. the eur-lex.europa.eu URL language path segment, `/{iso}/TXT/...`.
 */
export interface EuLanguage {
  /** Cellar/CDM 3-letter language code, e.g. "DEU". Also the language-URI suffix. */
  readonly code: string;
  /** ISO 639-1 two-letter tag, e.g. "de". HTTP Accept-Language + SPARQL LANG() + eur-lex path. */
  readonly iso: string;
}

export const EU_LANGUAGES = [
  { code: 'BUL', iso: 'bg' },
  { code: 'SPA', iso: 'es' },
  { code: 'CES', iso: 'cs' },
  { code: 'DAN', iso: 'da' },
  { code: 'DEU', iso: 'de' },
  { code: 'EST', iso: 'et' },
  { code: 'ELL', iso: 'el' },
  { code: 'ENG', iso: 'en' },
  { code: 'FRA', iso: 'fr' },
  { code: 'GLE', iso: 'ga' },
  { code: 'HRV', iso: 'hr' },
  { code: 'ITA', iso: 'it' },
  { code: 'LAV', iso: 'lv' },
  { code: 'LIT', iso: 'lt' },
  { code: 'HUN', iso: 'hu' },
  { code: 'MLT', iso: 'mt' },
  { code: 'NLD', iso: 'nl' },
  { code: 'POL', iso: 'pl' },
  { code: 'POR', iso: 'pt' },
  { code: 'RON', iso: 'ro' },
  { code: 'SLK', iso: 'sk' },
  { code: 'SLV', iso: 'sl' },
  { code: 'FIN', iso: 'fi' },
  { code: 'SWE', iso: 'sv' },
] as const satisfies readonly EuLanguage[];

/** Union of the 24 valid Cellar language codes, e.g. "DEU" | "POL" | … */
export type LanguageCode = (typeof EU_LANGUAGES)[number]['code'];

/**
 * The 24 language codes as a tuple, for `z.enum`. The `as` narrows the widened
 * `LanguageCode[]` from `.map` back to the non-empty tuple `z.enum` requires;
 * a tuple is a subtype of the array, so this is a safe narrowing assertion.
 */
export const LANGUAGE_CODES = EU_LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];

/**
 * The one Zod language enum, shared by every schema (replaces six hardcoded
 * `z.enum(['DEU','ENG','FRA'])`). Callers add `.default(DEFAULT_LANGUAGE).describe(...)`.
 */
export const LANGUAGE_ENUM = z.enum(LANGUAGE_CODES);

/**
 * Maps each Cellar language code to its ISO 639-1 tag. Serves the HTTP
 * Accept-Language header, the SPARQL `LANG()` filters, and the eur-lex URL path
 * (see EuLanguage docs). Typed `Record<string, string>` so existing call sites —
 * which index with a plain `string` and fall back on a miss — keep type-checking.
 */
export const LANGUAGE_ISO_MAP: Record<string, string> = Object.fromEntries(
  EU_LANGUAGES.map((l) => [l.code, l.iso]),
);

/** Name of the env var that overrides the built-in default language. */
export const DEFAULT_LANGUAGE_ENV_VAR = 'EURLEX_DEFAULT_LANGUAGE';

/** Built-in fallback language when no valid override is supplied. */
const FALLBACK_LANGUAGE: LanguageCode = 'ENG';

/**
 * Resolves the process-wide default language from a raw env-var value.
 *
 * - `undefined`, empty, or whitespace-only → the built-in fallback (`ENG`),
 *   silently (an unset env var is the normal case, not a misconfiguration).
 * - A valid Cellar code (case-insensitive, surrounding whitespace trimmed) →
 *   that code, normalized to upper case.
 * - Anything else → the fallback, plus a single warning line on **stderr**
 *   (never stdout — the stdio transport reserves stdout for MCP protocol
 *   frames). Never throws.
 */
export function resolveDefaultLanguage(raw: string | undefined): LanguageCode {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return FALLBACK_LANGUAGE;
  }
  const normalized = trimmed.toUpperCase();
  const match = EU_LANGUAGES.find((l) => l.code === normalized);
  if (match) {
    return match.code;
  }
  console.error(
    `[eurlex-mcp] Ignoring invalid ${DEFAULT_LANGUAGE_ENV_VAR}="${raw}"; ` +
      `expected one of the 24 Cellar language codes. Falling back to ${FALLBACK_LANGUAGE}.`,
  );
  return FALLBACK_LANGUAGE;
}

/**
 * The process-wide default language for every language-aware tool schema.
 * Evaluated once at module load so schemas capture it at startup; override
 * with the `EURLEX_DEFAULT_LANGUAGE` env var (built-in default `ENG`).
 */
export const DEFAULT_LANGUAGE = resolveDefaultLanguage(process.env[DEFAULT_LANGUAGE_ENV_VAR]);
