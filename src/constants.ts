export const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
export const CELLAR_REST_BASE = 'https://publications.europa.eu/resource/celex';
export const EURLEX_BASE = 'https://eur-lex.europa.eu/legal-content';
export const DEFAULT_LANGUAGE = 'DEU';
export const DEFAULT_LIMIT = 10;
export const MAX_CHARS_DEFAULT = 20000;
export const MAX_CHARS_LIMIT = 50000;
export const REQUEST_TIMEOUT_MS = 30000;
export const SESSION_TTL_MS = 30 * 60 * 1000;

// Retry policy for Cellar SPARQL/REST calls: retry on network errors, timeouts,
// and HTTP 5xx — never on 4xx. Max 2 retries with 500ms then 1500ms delay.
export const MAX_RETRIES = 2;
export const RETRY_DELAYS_MS = [500, 1500];

// {4,30} — supports parenthesized corrigenda suffixes, e.g. 32023D2454(02)
export const CELEX_REGEX = /^\d[A-Z0-9()]{4,30}$/;

export const RESOURCE_TYPES = [
  'REG',
  'REG_IMPL',
  'REG_DEL',
  'DIR',
  'DIR_IMPL',
  'DIR_DEL',
  'DEC',
  'DEC_IMPL',
  'DEC_DEL',
  'JUDG',
  'ORDER',
  'OPIN_AG',
  'RECO',
  'any',
] as const;
