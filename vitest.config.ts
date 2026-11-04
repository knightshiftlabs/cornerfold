import { defineConfig } from 'vitest/config'

// Tests run the real app code under Node (engine, compression, parsing) and a simulated
// browser (interface). See tests/README.md.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react$/, replacement: 'preact/compat' },
      // These packages have no "exports" map, so Node would pick their CommonJS builds, which load
      // real React instead of Preact. Point them at their modern builds instead.
      { find: /^lucide-react$/, replacement: 'lucide-react/dist/esm/lucide-react.js' },
      { find: /^@dnd-kit\/(core|sortable|utilities|accessibility)$/, replacement: '@dnd-kit/$1/dist/$1.esm.js' },
    ],
  },
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/fuzz/**', 'tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks', // each file gets a clean process, since the worker sets globals
    // Libraries that import React must be bundled through the Preact alias, not loaded as-is.
    server: { deps: { inline: ['zustand', /@dnd-kit/, 'lucide-react'] } },
  },
})
