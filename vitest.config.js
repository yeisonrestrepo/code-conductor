import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    pool: 'threads',
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
  },
})
