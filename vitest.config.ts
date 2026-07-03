import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    exclude: ['tests/integration/**', 'tests/eval/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/http.ts', 'src/types.ts'],
      // Floor set ~5 points below the actual run (99.26% stmts/lines, 93.46%
      // branch, 100% funcs as of 2026-07-03) so a future PR can't silently
      // erode coverage; not a target to write down to.
      thresholds: {
        statements: 94,
        lines: 94,
        functions: 95,
        branches: 88,
      },
    },
  },
});
