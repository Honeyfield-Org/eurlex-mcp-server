# eurlex-mcp-server

[![CI](https://github.com/Honeyfield-Org/eurlex-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/Honeyfield-Org/eurlex-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/eurlex-mcp-server)](https://www.npmjs.com/package/eurlex-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io/)

**Search and retrieve EU law via the EUR-Lex Cellar API** -- an MCP server that gives AI assistants direct access to EU regulations, directives, court decisions, and more. No API key required.

## What You Can Do

Ask your AI assistant questions like:

- _"Find EU regulations about artificial intelligence from 2024"_
- _"Show me the full text of the AI Act (32024R1689)"_
- _"What EuroVoc topics are assigned to the GDPR?"_
- _"Which EU acts are about cybersecurity as a topic, even if the word isn't in the title?"_
- _"Which documents cite the Digital Services Act?"_
- _"Search for directives about renewable energy"_
- _"Get the consolidated version of Regulation 2016/679 (GDPR)"_
- _"Which CJEU judgments interpret the GDPR?"_
- _"Look up the Court of Justice ruling with ECLI ECLI:EU:C:2014:317"_
- _"How did Germany transpose the NIS2 Directive?"_
- _"Outline the AI Act, then show me just Article 5"_
- _"Give me the plain-language summary of the Digital Services Act"_

## Features

- **11 specialized tools** for searching, fetching, and analyzing EU legal documents (see [Tool Reference](#tool-reference))
- **EuroVoc thesaurus search** -- find documents by EU taxonomy concepts, with automatic label fallback across all 24 languages
- **CJEU case law** -- find judgments, orders, and Advocate General opinions by ECLI, CELEX, party/title, or the act they interpret
- **National transposition measures (NIM)** -- list how member states transposed a given directive into national law
- **Document outline + targeted reading** -- get an act's table of contents with plain-text offsets, then jump straight to a specific article with `eurlex_fetch`; for CJEU case law (CELEX sector 6) the outline also lists each numbered judgment paragraph as `Paragraph N`, so you can jump to a specific paragraph the same way (paragraph detection is language-independent)
- **Plain-language summaries** -- retrieve the EU's LEGISSUM summary of an act
- **Raw SPARQL escape hatch** -- run read-only `SELECT`/`ASK` queries directly against Cellar for questions the other tools can't express
- **Consolidated versions** -- retrieve the latest in-force text of regulations, directives, and decisions, identified by CELEX ID or by doc type + year + number
- **Citation graph** -- explore which documents cite or are cited by a given act, with a balanced split between the two directions
- **Structured metadata** -- dates (with `null` instead of Cellar's `9999-12-31` sentinel for open-ended validity), in-force status, authors, legal basis, EuroVoc descriptors, and directory codes
- **Flexible identifiers** -- `eurlex_fetch`, `eurlex_metadata`, and `eurlex_structure` accept a CELEX ID, an ELI (e.g. `reg/2016/679`), or a post-2023 Official Journal reference (e.g. `OJ:L_202401689`)
- **Structured output** -- every tool returns a machine-readable `structuredContent` payload validated against a published `outputSchema`, alongside the JSON text block
- **Offset-based pagination** -- `eurlex_fetch`, `eurlex_consolidated`, and `eurlex_summary` return `next_offset` so long documents can be read in successive calls
- **All 24 official EU languages** -- request titles and full text in any official EU language (default German)
- **No API key required** -- uses the public EUR-Lex Cellar SPARQL endpoint
- **Resilient by default** -- automatic retry with backoff on transient Cellar errors, and in-process caching of EuroVoc labels, consolidated-CELEX lookups, and metadata to cut latency on repeat requests

## Quick Start

```bash
pnpm dlx eurlex-mcp-server
```

Or with npx:

```bash
npx -y eurlex-mcp-server
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eurlex": {
      "command": "npx",
      "args": ["-y", "eurlex-mcp-server"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add eurlex-mcp-server -- npx -y eurlex-mcp-server
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "eurlex": {
      "command": "npx",
      "args": ["-y", "eurlex-mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "eurlex": {
      "command": "npx",
      "args": ["-y", "eurlex-mcp-server"]
    }
  }
}
```

### Windsurf

Add to `~/.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "eurlex": {
      "command": "npx",
      "args": ["-y", "eurlex-mcp-server"]
    }
  }
}
```

### HTTP Transport (Remote Deployments)

When running the server over HTTP (`pnpm start:http` / `dist/http.js`) instead of stdio, it's exposed
to any client that can reach it over the network. To protect against DNS rebinding attacks, set these
environment variables:

| Variable | Required | Description |
|----------|----------|--------------|
| `MCP_ALLOWED_HOSTS` | no (but strongly recommended for public deployments) | Comma-separated list of allowed `Host` header values. Must match the header **exactly**, including the port if the server isn't reachable on the default HTTP(S) port. |
| `MCP_ALLOWED_ORIGINS` | no | Comma-separated list of allowed `Origin` header values. Only enforced when `MCP_ALLOWED_ORIGINS` is set together with `MCP_ALLOWED_HOSTS`. |

**Important:** If your server runs behind a reverse proxy or load balancer, ensure it forwards the original `Host` header unmodified (e.g. nginx `proxy_set_header Host $host;`), otherwise `MCP_ALLOWED_HOSTS` validation will reject all legitimate traffic — the SDK compares the raw Host header as an exact string.

Production example:

```bash
MCP_ALLOWED_HOSTS=mcp.honeyfield.at
```

**This protection is opt-in.** If `MCP_ALLOWED_HOSTS` is not set, the server starts as before and logs
a one-line startup warning (`MCP_ALLOWED_HOSTS not set — DNS rebinding protection disabled`). Any public
deployment should set `MCP_ALLOWED_HOSTS` to its public hostname(s).

## Tool Reference

The server exposes **11 read-only tools**. Every tool returns both a JSON text block and a machine-readable `structuredContent` payload validated against a published `outputSchema`, so MCP clients can consume either representation. Tools that return titles or document text accept a `language` parameter taking any of the 24 official EU languages as a Cellar 3-letter code (default `DEU`): `BUL`, `SPA`, `CES`, `DAN`, `DEU`, `EST`, `ELL`, `ENG`, `FRA`, `GLE`, `HRV`, `ITA`, `LAV`, `LIT`, `HUN`, `MLT`, `NLD`, `POL`, `POR`, `RON`, `SLK`, `SLV`, `FIN`, `SWE`.

| Tool | Purpose |
|------|---------|
| `eurlex_search` | Title-substring search over legislation |
| `eurlex_fetch` | Full text of an act (by CELEX / ELI / OJ reference) |
| `eurlex_metadata` | Structured metadata for an act |
| `eurlex_citations` | Citation graph (cites / cited-by / amends / …) |
| `eurlex_by_eurovoc` | Thematic search by EuroVoc concept |
| `eurlex_consolidated` | Latest in-force consolidated text |
| `eurlex_case_law` | CJEU judgments, orders, and AG opinions |
| `eurlex_transposition` | National transposition measures for a directive |
| `eurlex_structure` | Document outline with plain-text offsets |
| `eurlex_summary` | Plain-language LEGISSUM summary |
| `eurlex_sparql` | Raw read-only SPARQL escape hatch |

### eurlex_search

Searches EU legal acts by **title substring** -- a contiguous, case-insensitive phrase match against the document title, not tokenized full-text search. For thematic discovery (the term may not appear in the title) use `eurlex_by_eurovoc` instead. Results are sorted newest-first *within the fetched sample*: for very broad single-word queries this is not guaranteed to be the globally newest match -- narrow with `resource_type` or `date_from`/`date_to` if that matters. The response no longer echoes the internal SPARQL query.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Title substring to match (3-500 chars), e.g. `"artificial intelligence high risk"` |
| `resource_type` | string | no | `"any"` | Document type filter: `REG`, `DIR`, `DEC`, `JUDG`, `REG_IMPL`, `REG_DEL`, `DIR_IMPL`, `DIR_DEL`, `DEC_IMPL`, `DEC_DEL`, `ORDER`, `OPIN_AG`, `RECO`, `any` |
| `language` | string | no | `"DEU"` | Language for titles and full text: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |
| `limit` | number | no | `10` | Max results (1-50) |
| `date_from` | string | no | -- | Filter from date, format: `YYYY-MM-DD` |
| `date_to` | string | no | -- | Filter to date, format: `YYYY-MM-DD` |

### eurlex_fetch

Retrieve the full text of a document, identified by **exactly one** of `celex_id`, `eli`, or `oj_ref`. Long documents are paginated: the response includes `returned_chars`, `total_chars`, and `next_offset` (pass it as the next call's `offset` to keep reading; `next_offset` is `null` once there's nothing left).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | no\* | -- | CELEX identifier, e.g. `"32024R1689"` for the AI Act |
| `eli` | string | no\* | -- | European Legislation Identifier, short (`reg/2016/679`) or full (`http://data.europa.eu/eli/reg/2016/679/oj`); resolved to a CELEX via Cellar |
| `oj_ref` | string | no\* | -- | Post-2023 Official Journal reference, e.g. `"OJ:L_202401689"` (AI Act); resolved to a CELEX via Cellar |
| `language` | string | no | `"DEU"` | Language: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |
| `format` | string | no | `"xhtml"` | Output format: `xhtml` (structured) or `plain` (tags stripped, whitespace collapsed, entities decoded) |
| `max_chars` | number | no | `20000` | Max characters returned per call (1000-50000) |
| `offset` | number | no | `0` | Character offset into the processed document, for pagination |

\* Provide exactly one of `celex_id`, `eli`, or `oj_ref`.

### eurlex_metadata

Retrieve structured metadata for a document: document/entry-into-force/end-of-validity/transposition dates, in-force status, authors, legal basis, EuroVoc descriptors, and directory codes. Identified by **exactly one** of `celex_id`, `eli`, or `oj_ref` (same identifier inputs as `eurlex_fetch`).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | no\* | -- | CELEX identifier, e.g. `"32024R1689"` |
| `eli` | string | no\* | -- | European Legislation Identifier, short or full form; resolved to a CELEX via Cellar |
| `oj_ref` | string | no\* | -- | Post-2023 Official Journal reference, e.g. `"OJ:L_202401689"`; resolved to a CELEX via Cellar |
| `language` | string | no | `"DEU"` | Language for titles and EuroVoc labels: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |

\* Provide exactly one of `celex_id`, `eli`, or `oj_ref`.

Notes on the response:
- `authors` lists the resolved agent names (e.g. "European Parliament", "Council of the European Union") instead of an empty array.
- `legal_basis` lists the CELEX IDs of the acts this document is based on.
- Date fields (`date_document`, `date_entry_into_force`, `date_end_of_validity`, `date_transposition`) are `null` when absent -- including Cellar's `9999-12-31` sentinel for acts with no defined end of validity, which is normalized to `null`.
- `directory_codes` are human-readable (`"{code-tail}: {label}"`, where `code-tail` is the fragment after the last `/` of the directory-code URI), not raw URIs.

### eurlex_citations

Explore the citation graph of a document -- which acts it cites, which acts cite it, and amends/based-on/repeals relations.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | CELEX identifier, e.g. `"32024R1689"` |
| `language` | string | no | `"DEU"` | Language for titles: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |
| `direction` | string | no | `"both"` | `cites` (outgoing), `cited_by` (incoming), or `both` |
| `limit` | number | no | `20` | Max results (1-100) |

With `direction: "both"`, the two directions are queried and split evenly (roughly `limit / 2` each) so that a burst of recent `cited_by` entries can't crowd out `cites` results. The response includes a `counts: { cites, cited_by }` object reporting how many of each were actually found.

### eurlex_by_eurovoc

Find documents by EuroVoc thesaurus concept (label or URI).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `concept` | string | yes | -- | EuroVoc concept: label (e.g. `"artificial intelligence"`) or URI (e.g. `"http://eurovoc.europa.eu/4424"`) |
| `resource_type` | string | no | `"any"` | Document type filter (same values as `eurlex_search`) |
| `language` | string | no | `"DEU"` | Language: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |
| `limit` | number | no | `10` | Max results (1-50) |

### eurlex_consolidated

Retrieve the consolidated (in-force) version of a regulation, directive, or decision. Identify the act with **either** `celex_id` **or** `doc_type` + `year` + `number` -- provide exactly one of the two forms. Like `eurlex_fetch`, the content is paginated via `offset`/`max_chars`/`next_offset`. The response also includes `consolidated_celex` (e.g. `"02016R0679-20160504"`) and `consolidation_date` (`"2016-05-04"`, parsed from that CELEX's date suffix; `null` if the resolved CELEX has none).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | no* | -- | CELEX ID of the original act, e.g. `"32016R0679"` (GDPR). Alternative to `doc_type`+`year`+`number`; must be a sector-3 CELEX (`3YYYY[R\|L\|D]NNNN`) |
| `doc_type` | string | no* | -- | Document type: `reg` (regulation), `dir` (directive), `dec` (decision). Alternative to `celex_id`; provide together with `year` and `number` |
| `year` | number | no* | -- | Year of the act (1950-2100), e.g. `2024`. Required together with `doc_type` and `number` when `celex_id` is not used |
| `number` | number | no* | -- | Document number, e.g. `1689`. Required together with `doc_type` and `year` when `celex_id` is not used |
| `language` | string | no | `"DEU"` | Language: any of the 24 official EU languages (Cellar 3-letter code, e.g. `DEU`, `ENG`, `FRA`, `POL`, `SPA`) |
| `format` | string | no | `"xhtml"` | Output format: `xhtml` or `plain` |
| `max_chars` | number | no | `20000` | Max characters returned per call (1000-50000) |
| `offset` | number | no | `0` | Character offset into the processed document, for pagination |

\* Exactly one of `celex_id` or the `doc_type`+`year`+`number` triple must be provided.

### eurlex_case_law

Search Court of Justice of the EU case law -- judgments, orders, and Advocate General opinions of the Court of Justice and the General Court. Provide **at least one** of `query`, `celex_id`, `ecli`, or `related_celex` (they may be combined). Each result gives `celex`, `ecli`, `title`, `date`, `type`, and `eurlex_url`. Use this for case law; `eurlex_search` covers only legislation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | no\* | -- | Title/party substring (3-500 chars). CJEU titles start with a `"Judgment of the Court …"` prefix, so party names appear after it |
| `celex_id` | string | no\* | -- | Sector-6 CELEX of a specific ruling, e.g. `"62012CJ0131"` (Google Spain) |
| `ecli` | string | no\* | -- | European Case Law Identifier, e.g. `"ECLI:EU:C:2014:317"` |
| `related_celex` | string | no\* | -- | CELEX of a legal act (e.g. `"32016R0679"` GDPR); returns the case law interpreting that act |
| `court` | string | no | `"any"` | `COURT_JUSTICE`, `GENERAL_COURT`, or `any` |
| `type` | string | no | `"any"` | `JUDG`, `ORDER`, `OPIN_AG`, or `any` |
| `language` | string | no | `"DEU"` | Language of the title: any of the 24 official EU languages (Cellar 3-letter code) |
| `limit` | number | no | `10` | Max results (1-50) |
| `date_from` | string | no | -- | Filter from this judgment date, format `YYYY-MM-DD` |
| `date_to` | string | no | -- | Filter up to this judgment date, format `YYYY-MM-DD` |

\* Provide at least one of `query`, `celex_id`, `ecli`, or `related_celex`.

### eurlex_transposition

List the national implementing measures (NIMs) EU member states enacted to transpose a directive into national law -- for transposition and compliance tracking. Each result gives the member state, the national measure's title (in that state's own official language, **not translated**), its date, the sector-7 NIM CELEX, and a EUR-Lex URL. `total_found` reports the full count; `results` is capped at `limit`. Regulations and decisions generally have no NIMs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | Sector-3 CELEX of the **directive**, e.g. `"32022L2555"` (NIS2) or `"31995L0046"` (Data Protection Directive) |
| `country` | string | no | -- | Filter by EU 2-letter member-state code (ISO 3166-1 alpha-2, except Greece = `EL`), e.g. `"DE"`, `"FR"`. Omit for all member states |
| `language` | string | no | `"DEU"` | Sets the locale of each `eurlex_url` (Cellar 3-letter code); does **not** translate NIM titles |
| `limit` | number | no | `20` | Max measures returned (1-100) |

### eurlex_structure

Return the outline (table of contents) of an act -- its chapters, sections, articles, and annexes -- each with a character `offset` into the document's **plain** text. Use it as a map for targeted reading: read an article's `offset`, then call `eurlex_fetch(celex_id, format:"plain", offset, max_chars)` to jump straight to that article. Pass the **same** `language` to the follow-up fetch and keep `format:"plain"` -- offsets are language- and plain-text-specific. Heading recognition covers English, German, and French. For case-law documents (CELEX sector 6, e.g. CJEU judgments) the outline additionally lists each numbered judgment paragraph as `"Paragraph N"` (level 4); numbered-paragraph detection is language-independent (it keys on the paragraph number, not heading words), so you can get the offset of e.g. paragraph 72 of a judgment and jump `eurlex_fetch` straight to it. Each outline entry has `level` (1=part/title/annex, 2=chapter, 3=section, 4=article/paragraph), `label` (e.g. `"Article 5"`, `"Paragraph 72"`), `title`, and `offset`; `total_headings` is the full count and the list is capped at 300 for very large acts (`truncated=true`).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | no\* | -- | CELEX identifier, e.g. `"32024R1689"` |
| `eli` | string | no\* | -- | European Legislation Identifier, short or full form; resolved to a CELEX via Cellar |
| `oj_ref` | string | no\* | -- | Post-2023 Official Journal reference, e.g. `"OJ:L_202401689"`; resolved to a CELEX via Cellar |
| `language` | string | no | `"DEU"` | Language of the document to outline (Cellar 3-letter code); heading labels and offsets are language-specific |

\* Provide exactly one of `celex_id`, `eli`, or `oj_ref`.

### eurlex_summary

Return the EU's own plain-language "summary of legislation" (LEGISSUM) for an act -- a good quick overview before reading the full legal text. Paginated like `eurlex_fetch` (`offset`/`max_chars`/`next_offset`). `total_summaries` is `0` when no summary exists (many acts have none); when several exist, the primary summary's text is returned and the rest are listed in `other_summaries`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | CELEX of the act to summarize, e.g. `"32016R0679"` (GDPR) or `"32022R2065"` (Digital Services Act) |
| `language` | string | no | `"DEU"` | Language of the summary (Cellar 3-letter code); summaries are typically available in all 24 languages |
| `max_chars` | number | no | `20000` | Max characters returned per call (1000-50000) |
| `offset` | number | no | `0` | Character offset into the processed summary, for pagination |

### eurlex_sparql

Expert escape hatch: run a raw, read-only SPARQL query directly against the Cellar endpoint for questions the other tools cannot express. Requires knowledge of the CDM ontology -- see the `eurlex_guide` prompt for a property cheat sheet. **Read-only:** only `SELECT` and `ASK` are accepted; SPARQL Update and federated `SERVICE` clauses are rejected. A `SELECT` with no top-level `LIMIT` gets `LIMIT 50` appended; a top-level `LIMIT` above 100 is rejected. The response carries `vars`/`bindings` (SELECT) or `boolean` (ASK) plus `row_count`, `returned_rows`, and a `truncated` flag (bindings are dropped whole to stay within a ~40,000-char budget).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | A raw SPARQL 1.1 `SELECT`/`ASK` query (10-5000 chars) against the Cellar endpoint |

## CELEX Number Schema

CELEX identifiers uniquely identify EU legal documents. The format is:

```
[sector][year][type][number]
```

- **Sector** (1 digit): `3` = legislation, `6` = case law, `7` = national transposition measures (the sectors these tools cover)
- **Year** (4 digits): year of the document
- **Type** (1-2 letters): `R` = regulation, `L` = directive, `D` = decision, `J` = judgment, etc.
- **Number**: sequential number

Examples:

| CELEX | Document |
|-------|----------|
| `32024R1689` | AI Act (Regulation 2024/1689) |
| `32016R0679` | GDPR (Regulation 2016/679) |
| `32022R2065` | Digital Services Act (Regulation 2022/2065) |
| `62014CJ0131` | Court of Justice case C-131/14 |

## Development

### Setup

```bash
git clone https://github.com/Honeyfield-Org/eurlex-mcp-server.git
cd eurlex-mcp-server
pnpm install
pnpm build
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:integration` | Run integration tests (hits real API) |
| `pnpm start` | Start production server |

### Testing

```bash
pnpm test              # unit tests
pnpm test:integration  # integration tests (hits real API)
```

## Limitations

- **Rate limits**: The EUR-Lex Cellar API is public but may throttle excessive requests.
- **Document availability**: Not all documents have full text in all languages.
- **Consolidated versions**: Only available for regulations, directives, and decisions.
- **Response size**: Full text is returned per call in `max_chars` slices (default 20,000 characters) to stay within LLM context limits -- use `offset`/`next_offset` on `eurlex_fetch`/`eurlex_consolidated`/`eurlex_summary` to read the rest.
- **SPARQL timeouts**: Complex queries may occasionally time out on the Cellar endpoint despite the built-in retry with backoff; narrow broad `eurlex_search`/`eurlex_by_eurovoc` queries with `resource_type` or date filters if this happens.
- **Search ordering**: `eurlex_search` results are sorted newest-first within the fetched sample only -- for very broad queries this is not guaranteed to be the single globally newest match.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and submission guidelines.

## License

[MIT](LICENSE)
