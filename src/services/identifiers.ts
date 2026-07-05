/**
 * Pure (network-free) normalization of the two alternative document identifiers
 * accepted by eurlex_fetch / eurlex_metadata next to a raw CELEX ID:
 *
 *   - ELI  (European Legislation Identifier), e.g. "reg/2016/679" or the full
 *     "http://data.europa.eu/eli/reg/2016/679/oj" (GDPR).
 *   - OJ reference in the post-2023 Official-Journal scheme, e.g. "OJ:L_202401689"
 *     (AI Act).
 *
 * These functions only produce the canonical URI to match in SPARQL; the actual
 * ELI/OJ -> CELEX resolution (which needs the network) lives in CellarClient.
 * Keeping the parsing here makes it fully unit-testable without mocking fetch,
 * and keeps this module free of any CellarClient import (no dependency cycle).
 *
 * Why resolve via SPARQL rather than deriving the CELEX arithmetically (probed
 * against live Cellar, 2026-07-05):
 *   - ELI numbers are the *natural* act number, unpadded (e.g. the 1995 Data
 *     Protection Directive is ELI "dir/1995/46/oj" but CELEX "31995L0046" — 4-digit
 *     zero-padded). Matching the stored ELI literal sidesteps the padding rules.
 *   - An OJ reference like "L_202401689" encodes only the OJ *series* ("L" =
 *     legislation) and a running number — NOT the act type. Directives share the
 *     same L series (e.g. "L_202401346" -> CELEX "32024L1346"), so R/L/D cannot be
 *     inferred from the OJ reference. A SPARQL lookup is the only correct path.
 */

/** Base of the ELI literal stored in `cdm:resource_legal_eli`. */
const ELI_LITERAL_BASE = 'http://data.europa.eu/eli/';

/** Base of the OJ resource URI linked via `owl:sameAs`. */
const OJ_RESOURCE_BASE = 'http://publications.europa.eu/resource/oj/';

/**
 * An ELI path is `{type}/{year}/{number}` (e.g. "reg/2016/679"), optionally with
 * further segments such as the "/oj" OJ-version marker. `type` is lowercase
 * letters/underscores (reg, dir, dec, reg_impl, …); `year` is four digits; the
 * remaining segments are the natural number and any qualifier.
 */
const ELI_PATH_REGEX = /^[a-z][a-z_]*\/\d{4}\/[0-9a-z()._-]+(\/[0-9a-z()._-]+)*$/i;

/** A full ELI URL on either the data.europa.eu or publications.europa.eu host. */
const ELI_URL_REGEX =
  /^https?:\/\/(?:data\.europa\.eu\/eli|publications\.europa\.eu\/resource\/eli)\/(.+)$/i;

/**
 * OJ reference in the post-2023 scheme: an "OJ:" prefix (case-insensitive)
 * followed by the OJ resource id, e.g. "OJ:L_202401689". The id part is
 * restricted to characters that are safe inside a SPARQL IRI (letters, digits,
 * underscore), so the resulting URI never needs escaping.
 */
const OJ_REF_REGEX = /^OJ:([A-Za-z0-9_]+)$/i;

const ELI_EXAMPLES =
  'Examples: "reg/2016/679" (GDPR), "dir/2022/2555" (NIS2), or the full form "http://data.europa.eu/eli/reg/2016/679/oj".';

const OJ_EXAMPLES = 'Example: "OJ:L_202401689" (AI Act).';

/**
 * Normalizes an ELI (full URL or short `type/year/number` form) to the canonical
 * literal stored in `cdm:resource_legal_eli`, i.e. an absolute
 * `http://data.europa.eu/eli/…/oj` URI. The base-act ELI always carries the "/oj"
 * OJ-version suffix (probed for reg/dir/dec), so it is appended when absent.
 *
 * @throws if the input does not look like an ELI, with example formats.
 */
export function normalizeEliToCanonicalUri(input: string): string {
  const trimmed = input.trim();

  const urlMatch = ELI_URL_REGEX.exec(trimmed);
  let path = urlMatch ? urlMatch[1] : trimmed;

  // Strip surrounding slashes so "/reg/2016/679/" and "reg/2016/679" agree.
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!ELI_PATH_REGEX.test(path)) {
    throw new Error(`Invalid ELI "${input}". ${ELI_EXAMPLES}`);
  }

  // The base-act ELI in Cellar always ends in "/oj"; add it for the short form.
  const segments = path.split('/');
  if (segments[segments.length - 1].toLowerCase() !== 'oj') {
    path = `${path}/oj`;
  }

  return `${ELI_LITERAL_BASE}${path}`;
}

/**
 * Normalizes an OJ reference like "OJ:L_202401689" to the OJ resource URI that a
 * work is linked to via `owl:sameAs`, e.g.
 * "http://publications.europa.eu/resource/oj/L_202401689". The series letter is
 * upper-cased (the canonical resource id form); digits are unaffected.
 *
 * @throws if the input is not an "OJ:"-prefixed reference, with an example.
 */
export function normalizeOjRefToResourceUri(input: string): string {
  const trimmed = input.trim();

  const match = OJ_REF_REGEX.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid OJ reference "${input}". ${OJ_EXAMPLES}`);
  }

  // Only letters/digits/underscore survived the regex, so upper-casing yields the
  // canonical "L_…"/"C_…" id and the URI is guaranteed IRI-safe (no escaping).
  const resourceId = match[1].toUpperCase();
  return `${OJ_RESOURCE_BASE}${resourceId}`;
}
