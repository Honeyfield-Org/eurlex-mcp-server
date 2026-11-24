# Handoff — 2026-11-24

Snapshot of the current state. Durable rules live in `CLAUDE.md`; this file
goes stale — re-check the live state (`gh pr list`, Dependabot alerts,
`pnpm audit`) before acting on it.

## Current state

- **Released:** `v2.4.5` (2026-11-17) — npm `latest`, Docker image, gateway.
  The deploy verify step reported live version `2.4.5`.
- **Dependabot alerts:** 0 open. **Code-scanning alerts:** 0 open.
- **`pnpm audit`** (full and `--prod`): no known vulnerabilities.
- **Open PRs:** none. `main` CI + CodeQL green at `bb23c04`.

## Done in this round (v2.4.4 → v2.4.5)

| PR | Change | Scope |
|----|--------|-------|
| #78, #80, #81 | Dependabot minor-and-patch groups | mixed |
| #79 | `qs` override `>=6.16.1 <7` (GHSA-6pq8-jhm2-2vcw) | runtime |
| #82 | `hono` 4.13.14 → 4.13.19, `@hono/node-server` 2.1.5 → 2.1.9 (alerts #33–#39) | runtime |
| #82 | `eslint` ^10.15.0, `typescript-eslint` + `@typescript-eslint/*` ^8.73.0, `eslint-plugin-import-x` ^4.18.1 → `minimatch` 11.0.5 (alert #32) | dev |
| #83 | Version bump 2.4.4 → 2.4.5 | release |

## Decisions

- **hono / @hono/node-server fixed via lockfile refresh, no override.** The MCP
  SDK's ranges (`hono ^4.11.4`, `@hono/node-server ^1.19.9 || ^2.0.5`) already
  allow the patched versions.
- **Released despite low practical exposure.** The SDK's
  `StreamableHTTPServerTransport` uses only `getRequestListener` from
  `@hono/node-server`; `hono` itself is only imported by an SDK example file;
  no WebSocket upgrades here. Released anyway because both packages ship in the
  Docker image.
- **minimatch #32:** left open on 2026-11-11 to wait for upstream (no override,
  no dismiss). Upstream unblocked it in Nov 2026; fixed in #82.
- **Runtime fix and dev bumps in one PR (#82)**, release as a separate bump PR
  (#83).

## Open / follow-up

- **Issue #50** — migrate to MCP SDK v2 (`@modelcontextprotocol/server`) +
  Zod 4.2 with native JSON Schema 2020-12. After that, drop
  `src/services/schemaDialectShim.ts` (workaround for #49).
- **Stale branches** — many merged branches remain locally and on `origin`
  (e.g. `chore/release-v2.4.4`, `fix/qs-6.16.1`). Cleanup not decided yet.
- **picomatch GHSA-fc5q-39xc-vjpf** — showed up in `pnpm audit` on 2026-11-18
  (dev-only, no patch). The advisory was **withdrawn** on 2026-11-18. Nothing to
  do; if it reappears, it is dev-only (`pnpm why picomatch --prod` is empty).

## Quirks hit in this round

- `pnpm add -D` / `pnpm update` pulled unrelated patch bumps (rolldown,
  postcss) into the lockfile. Clean method: see "Dependency security fixes" in
  `CLAUDE.md`.
- The npm registry `latest` lagged ~1–2 min behind the publish step. An
  `npm view <pkg>@<new>` 404 right after release is not a failure — check the
  `Publish to npm` log for `+ eurlex-mcp-server@<version>`.
- Local HTTP smoke test: a fixed port may already be taken by another dev
  server and answer with its own HTML. Pick a free port first (e.g. via
  `net.createServer().listen(0)`) and pass it as `PORT`.
