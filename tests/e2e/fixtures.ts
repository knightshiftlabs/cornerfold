// What every browser test shares: the documents, a guard that holds every test to the privacy promise,
// and an `app` helper so tests read like what a person does.
import { test as base, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export { expect }
export const FILES = join(process.cwd(), 'test-results', 'files')

export class App {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto('/')
    await expect(this.page.getByRole('button', { name: 'Choose files' }).first()).toBeVisible()
  }

  /** Adds test documents through the real file picker. */
  async add(...names: string[]) {
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser'),
      this.page.getByRole('button', { name: /^(Choose files|Add files)$/ }).first().click(),
    ])
    await chooser.setFiles(names.map((n) => join(FILES, n)))
  }

  cards = () => this.page.locator('li[aria-label^="Page "]')
  card = (n: number) => this.page.locator(`li[aria-label="Page ${n}"]`)
  notice = () => this.page.locator('[role="status"][aria-live="polite"]').first()

  /** Waits until this many page thumbnails have really been drawn, not just laid out. */
  async thumbnails(count: number) {
    await expect(this.cards()).toHaveCount(count)
    await expect
      .poll(() => this.page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('li[aria-label^="Page "] img')].filter((i) => i.complete && i.naturalWidth > 0).length), { timeout: 20_000 })
      .toBe(count)
  }

  /** Opens a tool from the Tools menu. */
  async tool(name: string | RegExp) {
    await this.page.getByRole('button', { name: 'Tools' }).click()
    await this.page.getByRole('menuitem', { name }).click()
  }

  dialog = () => this.page.getByRole('dialog')

  /** Runs `trigger` and returns the file it downloads. */
  async download(trigger: () => Promise<unknown>, timeout = 60_000) {
    const [download] = await Promise.all([this.page.waitForEvent('download', { timeout }), trigger()])
    return { name: download.suggestedFilename(), bytes: new Uint8Array(readFileSync((await download.path())!)) }
  }

  exportPdf = () => this.download(() => this.page.getByRole('button', { name: /^Export/ }).first().click())
}

type Fixtures = { guard: void; app: App }

export const test = base.extend<Fixtures>({
  // Every test, automatically: no request may leave the site, nothing may break the security policy, and
  // there may be no script errors. A tool that quietly phoned home would fail every test that touches it.
  guard: [
    async ({ page, context, baseURL }, use) => {
      const problems: string[] = []
      const origin = new URL(baseURL!).origin
      await context.addInitScript(() => {
        addEventListener('securitypolicyviolation', (e) => {
          const w = window as unknown as { __violations?: string[] }
          ;(w.__violations ??= []).push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}`)
        })
      })
      context.on('request', (r) => {
        const url = r.url()
        if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) problems.push(`request left the site: ${url}`)
      })
      page.on('pageerror', (e) => problems.push(`script error: ${e.message}`))
      page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`))
      await use()
      const violations = await page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? []).catch(() => [])
      problems.push(...violations.map((v) => `security policy: ${v}`))
      expect(problems, 'privacy and security guard').toEqual([])
    },
    { auto: true },
  ],
  app: async ({ page }, use) => use(new App(page)),
})
