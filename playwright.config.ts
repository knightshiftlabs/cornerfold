import { defineConfig, devices } from '@playwright/test'

// Real-browser tests: the production build, served with the site's real security headers
// (tests/e2e/server.mjs), driven in Chrome on a desktop and a phone. Build first: `npm run test:e2e` does both.
const PORT = 4173

// Developers whose machine can't download Playwright's own browser can point at another Chromium.
const chromium = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : undefined }
  : {}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No automatic retries: a test that only passes the second time is a bug to fix, not to hide.
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromium,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testIgnore: /phone\.spec/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec/ },
  ],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
})
