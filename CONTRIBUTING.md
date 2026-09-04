# Contributing to eurlex-mcp-server

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20
- **pnpm** (install via `corepack enable`)

## Getting Started

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/eurlex-mcp-server.git
cd eurlex-mcp-server

# Install dependencies
pnpm install

# Build
pnpm build

# Run checks
pnpm test
```

## Architecture Overview

```
src/
  index.ts          # Entry point — stdio/HTTP transport selection
  http.ts           # Entry point — HTTP/StreamableHTTP transport
  server.ts         # MCP server setup, tool registration
  constants.ts      # Shared constants (endpoints, regex, limits)
  types.ts          # Shared TypeScript types
  utils.ts          # Utility functions
  schemas/          # Zod schemas for tool input validation
    searchSchema.ts
    fetchSchema.ts
    metadataSchema.ts
    citationsSchema.ts
    eurovocSchema.ts
    consolidatedSchema.ts
  tools/            # Tool implementations (one file per tool)
    search.ts
    fetch.ts
    metadata.ts
    citations.ts
    eurovoc.ts
    consolidated.ts
  services/
    cellarClient.ts # HTTP/SPARQL client for EUR-Lex Cellar API
  prompts/          # MCP prompt templates
    guide.ts
```

**Data flow:**

```
Stdio:  MCP Client → index.ts → server.ts → tools/*.ts → cellarClient.ts → EUR-Lex Cellar API
HTTP:   MCP Client → http.ts  → server.ts → tools/*.ts → cellarClient.ts → EUR-Lex Cellar API
```

## Development Workflow

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm test` | Run unit tests with Vitest |
| `pnpm test:integration` | Run integration tests against live API |

## Code Conventions

- **English tool descriptions** -- all user-facing tool names and descriptions are in English.
- **ESM with `.js` extensions** -- import paths use `.js` extensions (TypeScript ESM convention).
- **Type imports** -- use `import type { ... }` for type-only imports.
- **Strict Zod schemas** -- all tool inputs are validated with `.strict()` schemas (no extra properties).
- **No `any`** -- avoid `any` types; use `unknown` and narrow with type guards.

## Formatting & Linting

The project uses:

- **Prettier** for code formatting
- **ESLint** for linting
- **Husky** pre-commit hooks to enforce both

Before committing, ensure your code passes:

```bash
pnpm build   # type-check
pnpm test    # unit tests
```

The pre-commit hook will run formatting and linting automatically.

## Writing Tests

- **Framework**: Vitest
- **Location**: `tests/` directory (flat structure, one file per module)
- **HTTP mocking**: Mock `cellarClient.ts` functions -- do not make real HTTP calls in unit tests
- **Integration tests**: Placed in `tests/integration/`, run with `pnpm test:integration`. One file: `pnpm test:integration tests/integration/<file>` — do not insert `--` before the path; pnpm forwards it and vitest then ignores the filter and runs the whole suite

Example test structure:

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('toolName', () => {
  it('should return results for valid input', async () => {
    // Arrange: mock the cellar client
    // Act: call the tool handler
    // Assert: verify the response
  })
})
```

## Adding a New Tool

1. **Define the schema** in `src/schemas/<toolName>Schema.ts`:

   ```typescript
   import { z } from 'zod'

   export const myToolSchema = z.object({
     param: z.string().describe('Description of param'),
   }).strict()

   export type MyToolInput = z.infer<typeof myToolSchema>
   ```

2. **Implement the tool** in `src/tools/<toolName>.ts`:

   ```typescript
   import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
   import { myToolSchema } from '../schemas/myToolSchema.js'
   import { CellarClient } from '../services/cellarClient.js'
   import { toolError } from '../utils.js'

   export async function handleMyTool(input: MyToolInput) {
     try {
       const parsed = myToolSchema.parse(input)
       const client = new CellarClient()
       // Build SPARQL query or REST call, transform and return results
     } catch (error) {
       return toolError(error)
     }
   }

   export function registerMyTool(server: McpServer): void {
     server.tool(
       'eurlex_my_tool',
       'Description of the tool',
       myToolSchema.shape,
       { readOnlyHint: true, destructiveHint: false },
       async (params) => handleMyTool(params),
     )
   }
   ```

3. **Register the tool** in `src/server.ts` -- import and call `registerMyTool(server)`.

4. **Write tests** in `tests/tools/<toolName>.test.ts`.

## Submitting Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-change
   ```

2. **Run all checks** before pushing:
   ```bash
   pnpm build && pnpm test
   ```

3. **Use conventional commits**:
   - `feat: add new tool for ...`
   - `fix: handle empty SPARQL response`
   - `docs: update README`
   - `refactor: extract shared query builder`
   - `test: add coverage for citations tool`
   - `chore: update dependencies`

4. **Open a Pull Request** against `main` with a clear description of what changed and why.

## Releasing

Releases are triggered by version tags:

```bash
pnpm version patch   # or minor / major
git push --follow-tags
```

This publishes to npm via CI.

## Questions?

Open an issue on [GitHub](https://github.com/philrox/eurlex-mcp-server/issues) -- we are happy to help.
