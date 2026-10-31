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
        description: 'Merge, split, compress, reorder and rotate PDFs. Files never leave your device.',
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
        // pdf.js worker is ~1 MB; cache it so the app works fully offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/privacy/, /^\/changes/, /^\/terms/, /^\/licenses/],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
})
