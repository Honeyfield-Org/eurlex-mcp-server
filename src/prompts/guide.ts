import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDE_TEXT = `# EUR-Lex Research Guide

## Available tools

### eurlex_search — Title search
Searches EU legal acts by title substring (contiguous phrase, case-insensitive — not tokenized full-text search). Supports filtering by resource_type, date_from/date_to, and language. Broad single-word queries over common terms can be slow against the Cellar SPARQL endpoint; narrow with resource_type or a date range if a search times out. Results are newest-first within the fetched sample, not necessarily the globally newest match for very broad queries.

### eurlex_fetch — Full text
Fetches the full text of a legal act by CELEX ID. Paginate long documents with offset and max_chars — pass the previous response's next_offset to continue reading until it is null.

### eurlex_metadata — Metadata lookup
Returns dates (document, entry into force, end of validity), in-force status, authors, legal basis (CELEX IDs of the acts it is based on), EuroVoc descriptors, and directory codes.

### eurlex_citations — Citations & relationships
Finds citations, legal basis, and amendments for a legal act. Directions: cites (referenced by this act), cited_by (acts referencing this one), both (a balanced split of both directions, with a counts field reporting how many of each side were found).

### eurlex_by_eurovoc — Thematic search
Searches legal acts by EuroVoc concept. Finds documents that don't have the search term in their title — the right tool for "documents about X". Accepts a label ("artificial intelligence") or a URI ("http://eurovoc.europa.eu/4424").

### eurlex_consolidated — Consolidated version
Fetches the currently in-force version (with all amendments merged in) via ELI. Identify the act with celex_id (e.g. "32016R0679") OR with doc_type + year + number — provide exactly one of the two. celex_id must be a sector-3 secondary-law CELEX (3YYYY[R|L|D]NNNN). Paginate with offset and max_chars like eurlex_fetch.

### eurlex_sparql — Raw SPARQL (expert escape hatch)
Runs a raw, read-only SPARQL query directly against the Cellar endpoint for questions the tools above cannot express. Only SELECT and ASK are accepted; SPARQL Update and federated SERVICE clauses are rejected. A SELECT with no top-level LIMIT gets LIMIT 50 appended; a top-level LIMIT above 100 is rejected. Use the CDM cheat sheet below to build queries. Match CELEX/ELI literals with FILTER(STR(?x) = "..."), because they are typed xsd:string.

## CELEX numbering scheme
- 3 = EU secondary legislation (regulations, directives, decisions)
- Then: year (4 digits) + type letter + document number
- Examples: 32024R1689 (AI Act), 32016R0679 (GDPR), 32022L2555 (NIS2)

## Type letter → resource_type mapping
| CELEX letter | resource_type | Meaning |
|---|---|---|
| R | REG | Regulation (directly applicable) |
| L | DIR | Directive (must be transposed) |
| D | DEC | Decision |

## Extended types
REG_IMPL (implementing regulation), REG_DEL (delegated regulation),
DIR_IMPL (implementing directive), DIR_DEL (delegated directive),
DEC_IMPL (implementing decision), DEC_DEL (delegated decision),
RECO (recommendation),
JUDG (judgment), ORDER (court order), OPIN_AG (Advocate General opinion)

## CDM cheat sheet (for eurlex_sparql)
The Cellar data model (CDM). These are exactly the properties the tools above use.

Prefixes:
- \`cdm: <http://publications.europa.eu/ontology/cdm#>\`
- \`skos: <http://www.w3.org/2004/02/skos/core#>\`
- \`owl: <http://www.w3.org/2002/07/owl#>\`
- \`xsd: <http://www.w3.org/2001/XMLSchema#>\`

A "work" is the abstract act; an "expression" is its language version. Bridge them
with \`?expr cdm:expression_belongs_to_work ?work\`.

Identity & typing (on the work):
- \`cdm:resource_legal_id_celex\` → CELEX literal (xsd:string; match with FILTER(STR(?x) = "..."))
- \`cdm:resource_legal_id_sector\` → sector digit as a string ("6" = case law)
- \`cdm:resource_legal_eli\` → ELI (xsd:anyURI); \`owl:sameAs\` → the OJ resource URI
- \`cdm:work_has_resource-type\` → \`.../resource/authority/resource-type/{REG|DIR|DEC|JUDG|...}\`

Title & language (on the expression):
- \`cdm:expression_uses_language\` → \`.../resource/authority/language/{ENG|DEU|FRA|POL|...}\` (Cellar 3-letter)
- \`cdm:expression_title\` → the title in that language
- SKOS/EuroVoc labels are filtered by ISO-2 tag: \`FILTER(LANG(?label) = "en")\`

Dates & status (on the work):
- \`cdm:work_date_document\`, \`cdm:resource_legal_date_entry-into-force\`,
  \`cdm:resource_legal_date_end-of-validity\` (9999-12-31 = open-ended),
  \`cdm:resource_legal_in-force\`, \`cdm:resource_legal_date_transposition\`

Actors & concepts:
- \`cdm:work_created_by_agent\` → \`.../authority/corporate-body/{EP|CJ|GCEU|...}\`; name via \`skos:prefLabel\`
- \`cdm:work_is_about_concept_eurovoc\` → EuroVoc concept (\`http://eurovoc.europa.eu/...\`); label via \`skos:prefLabel\`
- \`cdm:resource_legal_is_about_concept_directory-code\` → directory code

Relationships (work → work):
- \`cdm:work_cites_work\`, \`cdm:resource_legal_based_on_resource_legal\`,
  \`cdm:resource_legal_amends_resource_legal\`, \`cdm:resource_legal_repeals_resource_legal\`

Case law (sector 6):
- \`cdm:case-law_ecli\` → ECLI (uppercase); \`cdm:case-law_interpretes_resource_legal\` → the act interpreted

Transposition (national implementing measures, sector 7):
- \`cdm:measure_national_implementing_implements_resource_legal\` → the directive
- \`cdm:measure_national_implementing_implemented_by_country\` → \`.../authority/country/{alpha-3}\`
- NIM titles are on \`cdm:work_title\` (member-state language only, no expression_title)

Legislative summaries (LEGISSUM):
- \`cdm:summary_legislation_eu_summarizes_resource_legal\` → the act
- \`cdm:summary_legislation_eu_id_legissum\`, \`cdm:summary_legislation_eu_obsolete\`

## Search strategy
1. eurlex_search only matches titles → use eurlex_by_eurovoc for thematic discovery
2. Use search terms in the language of the title
3. No hits? Try synonyms (e.g. "AI" vs "artificial intelligence")
4. Known CELEX ID? → Use eurlex_fetch or eurlex_metadata directly
5. Legal relationships? → eurlex_citations for citation chains
6. Consolidated version? → eurlex_consolidated for the currently in-force text

## Languages
The language parameter accepts all 24 official EU languages, given as the Cellar
3-letter code: BUL, SPA, CES, DAN, DEU, EST, ELL, ENG, FRA, GLE, HRV, ITA, LAV,
LIT, HUN, MLT, NLD, POL, POR, RON, SLK, SLV, FIN, SWE (default DEU). Titles are
language-specific — match your search term to the chosen language. EuroVoc concept
labels (eurlex_by_eurovoc) also prefer that language, but automatically fall back
across all 24 official languages if it has no match, so any-language labels work.

## EuroVoc / title language examples
- language=ENG: "artificial intelligence", "data protection", "cybersecurity"
- language=DEU: "künstliche Intelligenz", "Datenschutz", "Cybersicherheit"
- language=FRA: "intelligence artificielle", "protection des données"
- language=POL: "sztuczna inteligencja"
- language=SPA: "inteligencia artificial"

## Well-known CELEX IDs
- AI Act: 32024R1689
- GDPR: 32016R0679
- NIS2 Directive: 32022L2555
- Digital Services Act: 32022R2065
- Digital Markets Act: 32022R1925
- Data Act: 32023R2854
- Data Governance Act: 32022R0868

## Limitations
- Very long documents are paginated via offset/max_chars — check next_offset to continue reading
- SPARQL response time: typically 2-10 seconds; broad title searches can be slower and may time out
- Not every document has an XHTML version
- Title/full-text search terms are still language-specific — no cross-language fallback there
- Not every legal act has a consolidated version`;

export function registerGuidePrompt(server: McpServer): void {
  server.prompt('eurlex_guide', {}, () => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: GUIDE_TEXT,
        },
      },
    ],
  }));
}
