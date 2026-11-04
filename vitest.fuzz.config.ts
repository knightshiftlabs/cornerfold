import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// Fuzzing: `npm run test:fuzz`. Slower than the main suite, so it runs separately.
// FUZZ_ITERATIONS (default 400) and FUZZ_SEED (default random) control the run.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/fuzz/**/*.test.ts'],
    exclude: [],
    testTimeout: 30 * 60_000,
    // pdf.js's own stray internal rejections on corrupt files are counted by the fuzzer, not fatal.
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
