# eurlex-mcp-server

[![CI](https://github.com/philrox/eurlex-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/philrox/eurlex-mcp-server/actions/workflows/ci.yml)
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
- _"Which documents cite the Digital Services Act?"_
- _"Search for directives about renewable energy"_
- _"Get the consolidated version of Regulation 2016/679 (GDPR)"_

## Features

- **6 specialized tools** for searching, fetching, and analyzing EU legal documents
- **EuroVoc thesaurus search** -- find documents by EU taxonomy concepts
- **Consolidated versions** -- retrieve the latest in-force text of regulations, directives, and decisions
- **Citation graph** -- explore which documents cite or are cited by a given act
- **Structured metadata** -- access dates, EuroVoc descriptors, legal basis, and more
- **Multi-language** -- supports English, German, and French
- **No API key required** -- uses the public EUR-Lex Cellar SPARQL endpoint

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

### eurlex_search

Full-text search across EUR-Lex documents.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Search term (3-500 chars), e.g. `"artificial intelligence high risk"` |
| `resource_type` | string | no | `"any"` | Document type filter: `REG`, `DIR`, `DEC`, `JUDG`, `REG_IMPL`, `REG_DEL`, `DIR_IMPL`, `DIR_DEL`, `DEC_IMPL`, `DEC_DEL`, `ORDER`, `OPIN_AG`, `RECO`, `any` |
| `language` | string | no | `"DEU"` | Language for titles and full text: `DEU`, `ENG`, `FRA` |
| `limit` | number | no | `10` | Max results (1-50) |
| `date_from` | string | no | -- | Filter from date, format: `YYYY-MM-DD` |
| `date_to` | string | no | -- | Filter to date, format: `YYYY-MM-DD` |

### eurlex_fetch

Retrieve the full text of a document by its CELEX identifier.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | CELEX identifier, e.g. `"32024R1689"` for the AI Act |
| `language` | string | no | `"DEU"` | Language: `DEU`, `ENG`, `FRA` |
| `format` | string | no | `"xhtml"` | Output format: `xhtml` (structured) or `plain` (tags stripped) |
| `max_chars` | number | no | `20000` | Max characters returned (1000-50000) |

### eurlex_metadata

Retrieve structured metadata for a document (dates, EuroVoc descriptors, legal basis, etc.).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | CELEX identifier, e.g. `"32024R1689"` |
| `language` | string | no | `"DEU"` | Language for titles and EuroVoc labels: `DEU`, `ENG`, `FRA` |

### eurlex_citations

Explore the citation graph of a document -- which acts it cites and which acts cite it.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `celex_id` | string | yes | -- | CELEX identifier, e.g. `"32024R1689"` |
| `language` | string | no | `"DEU"` | Language for titles: `DEU`, `ENG`, `FRA` |
| `direction` | string | no | `"both"` | `cites` (outgoing), `cited_by` (incoming), or `both` |
| `limit` | number | no | `20` | Max results (1-100) |

### eurlex_by_eurovoc

Find documents by EuroVoc thesaurus concept (label or URI).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `concept` | string | yes | -- | EuroVoc concept: label (e.g. `"artificial intelligence"`) or URI (e.g. `"http://eurovoc.europa.eu/4424"`) |
| `resource_type` | string | no | `"any"` | Document type filter (same values as `eurlex_search`) |
| `language` | string | no | `"DEU"` | Language: `DEU`, `ENG`, `FRA` |
| `limit` | number | no | `10` | Max results (1-50) |

### eurlex_consolidated

Retrieve the consolidated (in-force) version of a regulation, directive, or decision.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `doc_type` | string | yes | -- | Document type: `reg` (regulation), `dir` (directive), `dec` (decision) |
| `year` | number | yes | -- | Year of the act (1950-2100), e.g. `2024` |
| `number` | number | yes | -- | Document number, e.g. `1689` |
| `language` | string | no | `"DEU"` | Language: `DEU`, `ENG`, `FRA` |
| `format` | string | no | `"xhtml"` | Output format: `xhtml` or `plain` |
| `max_chars` | number | no | `20000` | Max characters returned (1000-50000) |

## CELEX Number Schema

CELEX identifiers uniquely identify EU legal documents. The format is:

```
[sector][year][type][number]
```

- **Sector** (1 digit): `3` = legislation, `6` = case law, `5` = preparatory acts
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
git clone https://github.com/philrox/eurlex-mcp-server.git
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
- **Response size**: Full text is truncated at `max_chars` (default 20,000 characters) to stay within LLM context limits.
- **SPARQL timeouts**: Complex EuroVoc queries may occasionally time out on the Cellar endpoint.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and submission guidelines.

## License

[MIT](LICENSE)
