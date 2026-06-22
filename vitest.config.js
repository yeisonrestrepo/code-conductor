import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
  },
})
