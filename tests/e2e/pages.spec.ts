// The pages that are not the app (About, What's new, Privacy, Check our claims, Terms): one look with the app,
// the choices made in Appearance carried over, readable in every theme and accent, and fitting a phone.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'
import { CHOICES } from '../../src/lib/prefs'

const PAGES = [
  ['About', '/about.html'],
  ["What’s new", '/changes.html'],
  ['Privacy', '/privacy.html'],
  ['Check our claims', '/verify.html'],
  ['Terms', '/terms.html'],
] as const
const look = (page: import('@playwright/test').Page, saved: Record<string, unknown>) => page.addInitScript(([k, v]) => localStorage.setItem(k as string, JSON.stringify(v)), ['cornerfold.look', saved])
const html = (page: import('@playwright/test').Page) => page.locator('html')

test.describe('the site pages', () => {
  for (const [name, path] of PAGES) {
    test(`${name}: the bar, the current page marked, and the way back to the tools`, async ({ page }) => {
      await page.goto(path)
      const bar = page.getByRole('banner')
      await expect(bar.getByRole('link', { name: 'Cornerfold', exact: true })).toBeVisible()
      await expect(bar.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      await expect(bar.getByRole('link', { name: 'Open Cornerfold' })).toHaveAttribute('href', '/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })

    test(`${name}: sets its text in the same font as the app`, async ({ page }) => {
      await page.goto('/')
      const app = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
      await page.goto(path)
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe(app)
    })

    test(`${name}: fits a phone without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 })
      await page.goto(path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    })
  }

  test('the look chosen in the app is the look of the other pages, at once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await look(page, { theme: 'dark', accent: 'pink', desk: 'slate' })
    await page.goto('/privacy.html')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await expect(html(page)).toHaveAttribute('data-accent', 'pink')
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).not.toMatch(/^rgb\((23\d|2[4-5]\d), /) // not the light desk
    const open = page.getByRole('link', { name: 'Open Cornerfold' })
    const pink = await open.evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.evaluate(() => (document.documentElement.dataset.accent = 'green'))
    expect(pink).toBe('rgb(214, 51, 108)')
    await expect.poll(() => open.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(pink)
  })

  test('with nothing chosen, the pages follow the device, dark or light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/about.html')
    // If this browser's own emulation does not report dark, there is nothing for the page to follow: skip, do not fail.
    test.skip(!(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)), 'this browser did not apply the dark colour scheme that was asked for')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/about.html')
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
  })

  test('Geist, for devices with no system font of their own, is served with the pages', async ({ page, request }) => {
    for (const f of ['geist-latin-wght-normal.woff2', 'geist-latin-ext-wght-normal.woff2']) {
      const res = await request.get(`/fonts/${f}`)
      expect(res.status(), f).toBe(200)
      expect(res.headers()['content-type'], f).toContain('font/woff2')
    }
    await page.goto('/about.html')
    expect(await page.evaluate(() => [...document.fonts].map((f) => f.family.replace(/"/g, '')))).toEqual(['Geist Variable', 'Geist Variable'])
  })

  test('the bar leads to the other pages', async ({ page }) => {
    await page.goto('/about.html')
    await page.getByRole('banner').getByRole('link', { name: 'Privacy' }).click()
    await expect(page).toHaveURL(/\/privacy$|\/privacy\.html$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  })
})

// Readable in every theme and accent, on every page.
test.describe('contrast on the site pages', () => {
  const themes = CHOICES.theme.filter((t) => t !== 'auto')
  const matrix: [string, Record<string, unknown>][] = [
    ...PAGES.flatMap(([, path]) => themes.map((theme) => [path, { theme }] as [string, Record<string, unknown>])),
    ...CHOICES.accent.flatMap((accent) => [['/verify.html', { theme: 'dark', accent }], ['/verify.html', { theme: 'light', accent }]] as [string, Record<string, unknown>][]),
    ...CHOICES.desk.flatMap((desk) => [['/privacy.html', { theme: 'dark', desk }], ['/privacy.html', { theme: 'light', desk }]] as [string, Record<string, unknown>][]),
    ['/about.html', { theme: 'dark', contrast: true }],
    ['/about.html', { theme: 'light', contrast: true }],
    ['/changes.html', { theme: 'dark', glass: 0 }],
    ['/changes.html', { theme: 'light', glass: 100 }],
  ]
  for (const [path, saved] of matrix) {
    test(`${path} is readable with ${JSON.stringify(saved)}`, async ({ page }) => {
      await look(page, saved)
      await page.goto(path)
      const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
      expect(result.violations.map((v) => v.nodes.map((n) => `${n.target} ${n.failureSummary?.split('\n')[1] ?? ''}`)).flat()).toEqual([])
    })
  }
})

test.describe('the Support page', () => {
  test('says Cornerfold is free, links to both support pages as plain links, and is reached from every footer', async ({ page }) => {
    await page.goto('/')
    await page.locator('footer').getByRole('link', { name: 'Support', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Support Cornerfold' })).toBeVisible()
    await expect(page.getByText('Every feature works without payment, a trial, an account, usage limits or watermarks.')).toBeVisible()
    for (const [name, href] of [['Ko-fi', 'https://ko-fi.com/knightshiftlabs'], ['Buy Me a Coffee', 'https://buymeacoffee.com/knightshiftlabs']] as const) {
      const link = page.getByRole('main').getByRole('link', { name, exact: true })
      await expect(link).toHaveAttribute('href', href)
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    for (const path of ['/about.html', '/privacy.html', '/terms.html', '/verify.html', '/changes.html']) {
      await page.goto(path)
      await expect(page.locator('main footer').getByRole('link', { name: 'Support', exact: true }), path).toHaveAttribute('href', '/support.html')
    }
  })

  test('fits a phone, and passes the accessibility checks', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/support.html')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations.map((v) => v.id)).toEqual([])
  })
})
