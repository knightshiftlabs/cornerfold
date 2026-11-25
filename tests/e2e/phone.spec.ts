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
  [/Protect with password/, 'Lock and export'],
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

test.describe('Fill and sign on a phone', () => {
  test.beforeEach(async ({ app }) => {
    await app.add('form.pdf')
    await app.thumbnails(5)
  })

  test('fits the screen, with every tool and the Done button within reach', async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).tap()
    const item = page.getByRole('menuitem', { name: /Fill and sign/ })
    await item.scrollIntoViewIfNeeded()
    await item.tap()
    const editor = page.getByRole('dialog', { name: 'Fill and sign' })
    await expect(editor.getByRole('img', { name: /^Page \d$/ })).toBeVisible({ timeout: 20_000 })
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const width = page.viewportSize()!.width
    for (const name of ['Done', 'Text', 'Signature', 'Tick', 'Cross', 'Date', 'Next page']) {
      const b = (await editor.getByRole('button', { name, exact: true }).boundingBox())!
      expect(b.x, name).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, name).toBeLessThanOrEqual(width)
      expect(b.height, name).toBeGreaterThanOrEqual(36) // big enough for a finger
    }
    const pageBox = (await editor.getByRole('img', { name: /^Page \d$/ }).boundingBox())!
    expect(pageBox.x + pageBox.width).toBeLessThanOrEqual(width)
  })

  test('the signature pad fits the screen, and a finger can draw on it', async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).tap()
    const item = page.getByRole('menuitem', { name: /Fill and sign/ })
    await item.scrollIntoViewIfNeeded()
    await item.tap()
    const editor = page.getByRole('dialog', { name: 'Fill and sign' })
    await expect(editor.getByRole('img', { name: /^Page \d$/ })).toBeVisible({ timeout: 20_000 })
    await editor.getByRole('button', { name: 'Signature', exact: true }).tap()
    const pad = page.getByLabel('Draw your signature here')
    await expect(pad).toBeVisible()
    // The sheet slides in; measure the pad only once it has stopped moving, or the strokes land beside it.
    await pad.evaluate((el) => Promise.all(el.closest('[role="dialog"]')!.getAnimations({ subtree: true }).map((a) => a.finished)))
    const b = (await pad.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    // A finger stroke, as touch events. Playwright's own touchscreen can only tap, so the stroke goes through a
    // debugging session of its own, which is closed again straight after: while it is open, Chrome stops turning
    // later taps into clicks (a quirk of the harness, not of the app; it cost a day to find).
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', b.x + 20, b.y + b.height / 2)
    for (let i = 1; i <= 12; i++) await touch('touchMove', b.x + 20 + i * 20, b.y + b.height / 2 + (i % 2 ? 15 : -15))
    await touch('touchEnd', 0, 0)
    await cdp.detach()
    await expect(page.getByRole('button', { name: 'Use this signature' })).toBeEnabled()
    // The stroke really is ink across the pad, not just a dot where the finger landed.
    const inked = await pad.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
      const columns = new Set<number>()
      for (let i = 3; i < d.length; i += 4) if (d[i] > 24) columns.add(((i >> 2) % c.width) >> 4)
      return columns.size
    })
    expect(inked).toBeGreaterThan(8)
    const use = page.getByRole('button', { name: 'Use this signature' })
    // Tap only once nothing is moving (the sheet, the button's own press effect), or a tap can land mid-animation.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
    await use.tap()
    // If the signature doesn't appear, say what the app said, so a failure explains itself.
    const placed = editor.getByRole('button', { name: /^Signature\./ })
    // A slow runner can swallow one tap; a person would simply tap again. Once, and only if the sheet is still open.
    if (!(await placed.waitFor({ timeout: 3_000 }).then(() => true, () => false)) && (await use.count())) await use.tap()
    const outcome = await Promise.race([
      placed.waitFor({ timeout: 10_000 }).then(() => 'placed'),
      page.getByRole('alert').waitFor({ timeout: 10_000 }).then(async () => `the app said: ${await page.getByRole('alert').innerText()}`),
    ]).catch(async () => `nothing happened; the sheet is ${(await page.getByRole('button', { name: 'Use this signature' }).count()) ? 'still open' : 'closed'}`)
    expect(outcome).toBe('placed')
  })
})
