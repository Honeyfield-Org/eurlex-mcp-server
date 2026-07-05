# CLAUDE.md

MCP server for EU law via the EUR-Lex **Cellar** API (SPARQL + REST). Exposes
**11 read-only tools** and one guide prompt over two transports: **stdio** and
**Streamable HTTP**. No API key — Cellar is a public endpoint.

## Quick Start

```bash
pnpm install
pnpm run build
```

## Development Commands

```bash
pnpm run dev             # Start with tsx (hot reload, stdio)
pnpm run dev:http        # Start HTTP server with tsx (hot reload)
pnpm run build           # Compile TypeScript (prebuild runs typecheck)
pnpm start               # Run compiled version (stdio)
pnpm run start:http      # Run HTTP server (Streamable HTTP transport)
pnpm run check           # typecheck + typecheck:tests + lint + format:check + test
pnpm run inspect         # Manual testing via MCP Inspector
```

`check` is the gate CI runs — it must be green before a PR merges or a release
tags. It bundles **five** steps: `typecheck` (src), `typecheck:tests` (tests, via
`tsconfig.test.json`), `lint`, `format:check`, and the unit `test` run.

## Testing

```bash
pnpm test                # Unit tests (vitest run) — fetch is mocked, no network
pnpm run test:watch      # Unit tests in watch mode
pnpm run test:coverage   # Unit tests with V8 coverage report
pnpm run test:integration # Live Cellar tests (network-dependent, separate config)
```

- **Unit tests** (`tests/*.test.ts`) mock `fetch` — they never touch the
  network and run in `pnpm run check`. `vitest.config.ts` excludes
  `tests/integration/**` and `tests/eval/**`.
- **Integration + eval tests** (`tests/integration/`, `tests/eval/`) hit the
  **live** Cellar endpoint and are network-dependent. They run only via
  `test:integration` (`vitest.integration.config.ts`), never in CI's `check`.
- **Coverage floor** (`vitest.config.ts`): 94% statements/lines, 95% functions,
  88% branches — set ~5 points below the actual run so a PR can't silently erode
  it. `src/index.ts`, `src/http.ts`, and `src/types.ts` are excluded.

## Code Quality

```bash
pnpm run typecheck       # TypeScript strict mode (src)
pnpm run typecheck:tests # TypeScript strict mode (tests, tsconfig.test.json)
pnpm run lint            # ESLint (typescript-eslint + import-x)
pnpm run lint:fix        # ESLint with auto-fix
pnpm run format          # Prettier format (src/)
pnpm run format:check    # Prettier check (src/)
```

Pre-commit hooks (Husky) run `lint-staged` (`prettier --write` + `eslint --fix`
on staged `src/**/*.ts`); a `commit-msg` hook runs commitlint. Commits must
follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `chore:`, …).

## Code Architecture

```
src/
├── index.ts              # Entry point (stdio transport)
├── http.ts               # Entry point (Streamable HTTP, Express, per-session)
├── server.ts             # createServer(): registers 11 tools + the guide prompt
├── version.ts            # Shared VERSION constant (from package.json)
├── constants.ts          # Endpoints, timeouts, cache TTLs, CELEX_REGEX, RESOURCE_TYPES, SPARQL limits
├── languages.ts          # EU_LANGUAGES (24) — single source of truth; LANGUAGE_ENUM, LANGUAGE_ISO_MAP
├── countries.ts          # EU member states (27) — single source of truth; alpha2↔alpha3, COUNTRY_ENUM
├── types.ts              # ToolResult<T> + per-tool output/param types
├── utils.ts              # processContent / stripHtml / parseOutline / sortDedupSlice / toolError / toCallToolResult
├── services/
│   ├── cellarClient.ts   # ALL SPARQL + REST: CellarClient class, withRetry, TTL caches, escapeSparqlString
│   ├── identifiers.ts     # Pure (network-free) ELI / OJ-ref → canonical-URI normalization
│   └── ttlCache.ts        # TtlCache: read-only expiry, no timers, caches null ("not found")
├── schemas/               # One Zod file per tool: input schema (.shape) + output schema
│   ├── searchSchema.ts    # searchResultSchema is shared by search + eurovoc
│   ├── fetchSchema.ts     # superRefine XOR (celex/eli/oj_ref); handler re-.parse()s to enforce it
│   └── …Schema.ts
├── tools/                 # Thin handlers — one file per tool
│   ├── search.ts          # handleEurlexSearch + registerSearchTool(server)
│   └── …
└── prompts/
    └── guide.ts           # `eurlex_guide` prompt: CDM cheat sheet + tool overview + search strategy
```

**The layering that matters:** `src/tools/*` are *thin* — they validate input,
call one or two `sharedCellarClient` methods, and shape the result. All
network I/O, SPARQL construction, retry, and caching live in
**`src/services/cellarClient.ts`**. `languages.ts` and `countries.ts` are the
**single sources of truth** for the language and member-state code lists; never
hardcode a language/country list anywhere else — import from them.

## Key Patterns

### Adding / modifying a tool

Follow the schema → tool → client → registration chain:

1. **Schema** (`src/schemas/<name>Schema.ts`): a `.strict()` Zod input schema
   and an output schema. Use the shared **`LANGUAGE_ENUM`** for any `language`
   field (`.default('DEU')`) and `COUNTRY_ENUM` for member-state filters — do
   not re-declare these enums. Object-level invariants like "exactly one of
   celex_id / eli / oj_ref" go in a `superRefine` (the SDK strips whole-object
   refinements, so the handler must re-validate with an explicit `.parse()`).
2. **Client method** (`cellarClient.ts`): build the SPARQL/REST call here. Every
   user-supplied string interpolated into SPARQL goes through
   **`escapeSparqlString`** (and `escapeRegexMetachars` first when it lands
   inside a `REGEX(...)`). Values that become URI *path segments* (language
   codes, country codes, CELEX) must be validated by an enum/regex, not escaped.
3. **Handler** (`src/tools/<name>.ts`): export `handleEurlexX(input)` returning a
   `ToolResult<T>`, and `registerXTool(server)`. Wrap the return in
   `toCallToolResult(...)` and route errors through `toolError(...)`.
4. **Registration**: `server.registerTool(name, { description, inputSchema:
   schema.shape, outputSchema: schema.shape, annotations }, handler)`.
   `annotations` carries the display `title` plus `readOnlyHint: true`,
   `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` (all
   tools are read-only against an external API). Add the `register…` call to
   `createServer()` in `src/server.ts`.
5. **Sync docs**: tool `description`s are **self-contained** (an LLM picks a tool
   from the description alone). When tools change, update **both** the
   `eurlex_guide` prompt (`src/prompts/guide.ts`) and `README.md` — they are kept
   in sync by hand.

### CellarClient internals

- **Retry** (`withRetry`): retries on network errors (`TypeError`), timeouts
  (`AbortError`/`TimeoutError`), and HTTP 5xx — **never** 4xx. Backoff delays
  `[500, 1500]ms` (`RETRY_DELAYS_MS`; `MAX_RETRIES` is derived from its length).
- **Timeout**: 30s per request (`AbortSignal.timeout(REQUEST_TIMEOUT_MS)`); a
  timeout surfaces as an error suggesting the user narrow the query.
- **TTL caches** (`TtlCache`, expiry checked on read, no timers): EuroVoc labels
  (24h / 500), consolidated-CELEX lookups (6h / 500), metadata (6h / 200). A
  legitimate `null` ("not found") **is** cached; errors are never cached.
- **`sharedCellarClient`** is the process-wide singleton the tools import.

## Conventions

- **English only** — tool descriptions, `.describe()` text, and user-facing error
  strings are all English (this server has no localized user output).
- **TDD** — write the reproducing/covering test first, then implement. Unit tests
  mock `fetch`; only `tests/integration/` and `tests/eval/` may hit the network.
- **ESM** — `"type": "module"`, `.js` extensions on relative imports, `Node16`
  module resolution. Use `type` imports; no explicit `any`; unused vars prefixed
  `_`. Import order is enforced by `eslint-plugin-import-x`.
- **Prettier**: single quotes, trailing commas (`all`), `printWidth` 100,
  semicolons, 2-space indent.

## CI/CD

GitHub Actions on push/PR to `main`:

- **CI** (`ci.yml`): matrix Node 20 + 22 → `pnpm run check`; Node 22 also uploads
  a coverage artifact.
- **Release** (`release.yml`): triggered by a `v*` tag.
- **Deploy** (`deploy.yml`): called by `release.yml`, and runnable manually.

### Release Flow

```
version-bump PR → merge to main → git tag v1.x.x → push tag
  → GitHub Release + npm publish (OIDC) + Docker build → ECR → gateway deploy (verified)
```

The version bump goes through a PR like any other change. Pushing the `v*` tag
then drives `release.yml`:

- **GitHub Release** via `softprops/action-gh-release` (auto-generated notes).
- **npm publish** using **npm Trusted Publishing (OIDC)** — there is **no
  `NPM_TOKEN`**. Trusted publishing requires **npm CLI ≥ 11.5.1**, so the
  workflow installs `npm@latest` first (Node 22 ships npm 10). Publish is
  `--provenance --access public` and is skipped idempotently if that version is
  already on the registry, so re-running a tag is safe.
- **Docker image** built and pushed to a private **ECR** registry
  (`:<version>` + `:latest`).

### Deployment

- **Automatic**: every `v*` tag builds the image and `deploy.yml` re-points
  `:latest` at that tag and switches the gateway container. A verify step polls
  the live `initialize` response and **fails the run** if the reported version
  doesn't match a semver tag.
- **Rollback**: run the **Deploy Gateway** workflow manually
  (`workflow_dispatch`) with any existing ECR tag (e.g. `2.0.0`) — no rebuild,
  just a re-point + container switch.
- Deploy targets (registry, instance, verify URL, compose dir) live in GitHub
  repo **Variables** (Settings → Secrets and variables → Actions), **not** in the
  YAML — this repo is **public**. Never commit instance names, IPs, server
  paths, or the registry hostname.

## Hosting: Two Transports

- **stdio** (`src/index.ts`): a single `McpServer`, used by local MCP clients
  (Claude Desktop, Claude Code, `npx eurlex-mcp-server`).
- **HTTP** (`src/http.ts`): Express + `StreamableHTTPServerTransport`, one
  `McpServer` **per session**. `POST /mcp` creates/reuses a session, `GET /mcp`
  is the SSE stream, `DELETE /mcp` tears it down; `GET /health` is the health
  check. Idle sessions are swept after `SESSION_TTL_MS` (30 min); a 60 req/min
  rate limit is keyed on the session id (or IP). The Docker `HEALTHCHECK` hits
  `/health`.

### HTTP env vars

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP listen port (default **3001**; Dockerfile `EXPOSE`s 3001). |
| `MCP_ALLOWED_HOSTS` | Comma-separated exact `Host` allow-list. **Opt-in** DNS-rebinding protection: unset → protection off + a one-line startup warning. Set it on any public deployment. |
| `MCP_ALLOWED_ORIGINS` | Comma-separated `Origin` allow-list; only enforced together with `MCP_ALLOWED_HOSTS`. |

DNS-rebinding protection compares the **raw** `Host` header as an exact string,
so a reverse proxy in front must forward `Host` **unchanged** (e.g. nginx
`proxy_set_header Host $host;`), including the port if non-default — otherwise
every request is rejected.

## MCP Tools (11)

All read-only. Language-aware tools accept any of the 24 official EU languages as
a Cellar 3-letter code (default `DEU`); the list is `EU_LANGUAGES` in
`languages.ts`.

| Tool | Purpose |
|------|---------|
| `eurlex_search` | Title-**substring** search over legislation (not full-text) |
| `eurlex_fetch` | Full text of an act (by CELEX / ELI / OJ ref), paginated |
| `eurlex_metadata` | Structured metadata (dates, in-force, authors, legal basis, EuroVoc, directory codes) |
| `eurlex_citations` | Citation graph — cites / cited_by / both |
| `eurlex_by_eurovoc` | Thematic search by EuroVoc concept (label or URI) |
| `eurlex_consolidated` | Latest in-force consolidated text (sector-3 acts) |
| `eurlex_case_law` | CJEU judgments / orders / AG opinions (sector 6) |
| `eurlex_transposition` | National implementing measures for a directive (sector 7) |
| `eurlex_structure` | Document outline with plain-text offsets |
| `eurlex_summary` | Plain-language LEGISSUM summary |
| `eurlex_sparql` | Raw read-only `SELECT`/`ASK` escape hatch |

Plus the **`eurlex_guide`** prompt — a CDM ontology cheat sheet and tool-routing
guide (mainly for driving `eurlex_sparql`).

## Cellar Quirks Worth Knowing

Probed against the live endpoint (see dated notes in `cellarClient.ts` /
`identifiers.ts`):

- **SPARQL latency**: typically 2–10s; broad single-word title searches are
  slower and can hit the 30s server timeout — narrow with `resource_type` or
  `date_from`/`date_to`.
- **Title search is substring, not tokenized full-text** — for "documents about
  X" where X may not be in the title, use `eurlex_by_eurovoc`.
- **CELEX sectors this server touches**: `3` = secondary legislation,
  `6` = case law, `7` = national transposition (NIM). `eurlex_consolidated`
  requires a sector-3 CELEX; `eurlex_case_law` a sector-6; NIMs carry sector-7.
- **ELI is stored as the unpadded natural act number** (e.g. Data Protection
  Directive is ELI `dir/1995/46` but CELEX `31995L0046`), so ELIs are resolved by
  matching the stored literal via SPARQL — **not** by deriving the CELEX
  arithmetically.
- **OJ series letter ≠ act type**: an OJ ref like `OJ:L_202401689` encodes only
  the series (`L` = legislation) and a running number; R/L/D can't be inferred
  from it → a SPARQL lookup resolves the real CELEX.
- **NIM titles are member-state-language only** — stored on `cdm:work_title`
  (no per-language expression title) and returned **untranslated**; the
  `language` param on `eurlex_transposition` only sets the `eurlex_url` locale.

## Documentation

- User-facing docs + tool reference: `README.md` (keep in sync with tools).
- Contributor guide: `CONTRIBUTING.md`.
- In-repo API/data-model notes: `docs/`.
- Cellar SPARQL endpoint: <https://publications.europa.eu/webapi/rdf/sparql>
