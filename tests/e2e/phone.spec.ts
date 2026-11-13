// Phones: small screens and touch. Nothing may be wider than the screen, every label stays on one line, and
// every tool can be reached and used. Both phone bugs in 1.3.0 were of exactly these kinds.
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

/** How far the page sticks out past the right edge of the screen, in pixels. */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** Labels in the toolbar that have wrapped onto a second line. */
const wrapped = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('header button, header span')]
      .filter((el) => el.getClientRects().length > 0 && (el.textContent ?? '').trim() && el.getBoundingClientRect().height > 44)
      .map((el) => (el.textContent ?? '').trim()),
  )

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
})

for (const width of [320, 360, 390]) {
  test(`at ${width} pixels wide the toolbar fits, with and without a selection`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 780 })
    expect(await overflow(page), 'nothing selected').toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    for (const count of [1, 4]) {
      for (let n = 1; n <= count; n++) await app.card(n).tap()
      await expect(page.locator('header')).toContainText(`${count}`)
      expect(await overflow(page), `${count} selected`).toBeLessThanOrEqual(0)
      expect(await wrapped(page), `${count} selected`).toEqual([])
      await page.getByRole('button', { name: 'Clear selection' }).tap()
    }
  })
}

test('the page cards show their buttons without hovering, since a phone can’t hover', async ({ app }) => {
  await expect(app.card(1).getByRole('button', { name: 'Enlarge page' })).toBeVisible()
  await expect(app.card(1).getByRole('button', { name: 'Delete page' })).toBeVisible()
})

test('the Tools menu rises from the bottom, inside the screen, and every tool can be reached', async ({ page }) => {
  await page.getByRole('button', { name: 'Tools' }).tap()
  const menu = page.getByRole('menu')
  const box = (await menu.boundingBox())!
  const screen = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width)
  expect(box.y + box.height).toBeLessThanOrEqual(screen.height + 0.5)
  expect(box.y).toBeGreaterThan(screen.height * 0.1) // near the bottom, not off the top (the 1.3.0 bug)
  const last = page.getByRole('menuitem', { name: /Watermark/ })
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
})

test('Compress and Split, which have no room in the toolbar, are in the Tools menu and work', async ({ page, app }) => {
  await expect(page.getByRole('button', { name: 'Compress' })).toBeHidden()
  await page.getByRole('button', { name: 'Tools' }).tap()
  await page.getByRole('menuitem', { name: /Compress/ }).tap()
  await expect(page.getByRole('dialog')).toContainText('Compress')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Tools' }).tap()
  const split = page.getByRole('menuitem', { name: /Split into single pages/ })
  await split.scrollIntoViewIfNeeded()
  const out = await app.download(() => split.tap())
  expect(out.name).toBe('report-pages.zip')
})

for (const [tool, action] of [
  [/^Select pages/, 'Select'],
  [/Split by ranges/, 'Split'],
  [/Page size for photos/, 'Use these settings'],
  [/^Images/, 'Save 4 images'],
  [/^Text/, 'Extract text'],
  [/Page numbers/, 'Export with page numbers'],
  [/Watermark/, 'Export with watermark'],
] as const) {
  test(`${tool.source.replace(/[\^\\]/g, '')}: the panel fits the screen and its main button can be reached`, async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).tap()
    const item = page.getByRole('menuitem', { name: tool })
    await item.scrollIntoViewIfNeeded()
    await item.tap()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const main = dialog.getByRole('button', { name: action, exact: true })
    await main.scrollIntoViewIfNeeded()
    await expect(main).toBeInViewport()
  })
}

test('the large preview fits the screen, with every control on it', async ({ page, app }) => {
  await app.card(1).getByRole('button', { name: 'Enlarge page' }).tap()
  const viewer = page.getByRole('dialog', { name: 'Page 1 of 4' })
  await expect.poll(() => viewer.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0)
  const width = page.viewportSize()!.width
  for (const name of ['Zoom out', 'Zoom in', 'Previous page', 'Next page', 'Close preview']) {
    const b = (await viewer.getByRole('button', { name }).boundingBox())!
    expect(b.x, name).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, name).toBeLessThanOrEqual(width)
  }
  const image = (await viewer.locator('img').boundingBox())!
  expect(image.x + image.width).toBeLessThanOrEqual(width)
})
