// A new version deployed while Cornerfold is open. Each test serves a copy of the build from a temporary folder,
// opens it, then "deploys" by changing the service worker file in that folder, which is what a real deploy does.
import { test, expect } from '@playwright/test'
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App } from './fixtures'
import { startServer } from './server.mjs'

async function openSite(page: import('@playwright/test').Page) {
  const dir = mkdtempSync(join(tmpdir(), 'cornerfold-site-'))
  cpSync('dist', dir, { recursive: true })
  const server = await startServer({ root: dir })
  await page.goto(server.url)
  await expect(page.getByRole('button', { name: 'Choose files' }).first()).toBeVisible()
  // Wait until the site's copy of itself is installed and in charge of this page.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true)
  await page.evaluate(() => ((window as unknown as { __old: boolean }).__old = true))
  const deploy = async () => {
    appendFileSync(join(dir, 'sw.js'), `\n// deployed ${Date.now()}\n`)
    await page.evaluate(async () => void (await (await navigator.serviceWorker.getRegistration())!.update()))
  }
  // A page that is in the middle of reloading cannot be asked anything, which also means it is no longer the old one.
  const stillOld = () => page.evaluate(() => (window as unknown as { __old?: boolean }).__old === true).catch(() => false)
  return { deploy, stillOld, done: async () => (await server.close(), rmSync(dir, { recursive: true, force: true })) }
}

test.describe('a new version while the page is open', () => {
  test('with nothing open, the page reloads into the new version by itself, with no hard refresh', async ({ page }) => {
    const site = await openSite(page)
    try {
      await site.deploy()
      await expect.poll(site.stillOld, { timeout: 20_000 }).toBe(false)
      await expect(page.getByRole('button', { name: 'Choose files' }).first()).toBeVisible()
    } finally {
      await site.done()
    }
  })

  test('with files open, it asks first, keeps the files until told, and reloads when told', async ({ page }) => {
    const app = new App(page)
    const site = await openSite(page)
    try {
      // A returning visitor: the page starts under a version that is already installed.
      await page.reload()
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true)
      await page.evaluate(() => ((window as unknown as { __old: boolean }).__old = true))
      await app.add('report.pdf')
      await app.thumbnails(4)
      await site.deploy()
      const bar = page.getByRole('status').filter({ hasText: 'A new version of Cornerfold is ready' })
      await expect(bar).toBeVisible({ timeout: 20_000 })
      expect(await site.stillOld()).toBe(true)
      await expect(app.cards()).toHaveCount(4)
      await bar.getByRole('button', { name: 'Later' }).click()
      await expect(bar).toBeHidden()
      expect(await site.stillOld()).toBe(true)
      // Asking again brings the bar back, and Reload now really reloads.
      await site.deploy()
      await expect(bar).toBeVisible({ timeout: 20_000 })
      await bar.getByRole('button', { name: 'Reload now' }).click()
      await expect.poll(site.stillOld, { timeout: 20_000 }).toBe(false)
    } finally {
      await site.done()
    }
  })
})
