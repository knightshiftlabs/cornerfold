import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Shown in the app footer. npm sets this when the build runs through `npm run`.
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // External script, not inline, so the strict CSP holds.
      injectRegister: 'script',
      manifest: {
        name: 'Cornerfold',
        short_name: 'Cornerfold',
        description: 'PDF tools that never see your files. Merge, split and compress PDFs on your device: nothing uploaded, no tracking, no account.',
        theme_color: '#DCE2EA',
        background_color: '#DCE2EA',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,txt}'],
        // The link-preview image is for chat apps and social sites, not for the app itself.
        globIgnores: ['og.png'],
        // pdf.js worker is ~1 MB; cache it so the app works fully offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/privacy/, /^\/changes/, /^\/terms/, /^\/licenses/],
      },
    }),
  ],
  // Preact's compatibility layer stands in for React: same API, about 35 KB less to download.
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Inline nothing as data: URLs, so the CSP can forbid them.
    assetsInlineLimit: 0,
    // Modern browsers preload modules natively; skip the polyfill and its fetch().
    modulePreload: { polyfill: false },
  },
})
