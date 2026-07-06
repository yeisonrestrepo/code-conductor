import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    pool: 'threads',
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // include is an allowlist, so only source is measured; the explicit exclude is
      // belt-and-suspenders so no test file can ever be counted toward the threshold.
      include: ['lib/installer/**', 'bin/**'],
      exclude: ['tests/**', '**/*.test.js'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
