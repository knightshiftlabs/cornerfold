// The Tools menu, end to end: each tool driven through its real panel, with every file it makes checked.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { test, expect } from './fixtures'
import { imageSize, load, pageSizes, seenText, unzip } from './pdf'

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.add('report.pdf') // four pages: 1 and 3 have text, 2 and 4 are blank
  await app.thumbnails(4)
})

const selectedCount = (page: import('@playwright/test').Page) => page.locator('header').innerText().then((t) => Number(t.match(/(\d+)\s*selected/)?.[1] ?? 0))

test('Select pages: a typed range selects those pages, and a page that doesn’t exist is explained', async ({ page, app }) => {
  await app.tool(/^Select pages/)
  const field = page.locator('#select-ranges')
  await field.fill('2-9')
  await expect(app.dialog()).toContainText('There is no page 9. This document has 4 pages.')
  await expect(app.dialog().getByRole('button', { name: 'Select', exact: true })).toBeDisabled()
  await field.fill('1-2, 4')
  await expect(app.dialog()).toContainText('Selects 3 of 4 pages.')
  await field.press('Enter')
  await expect.poll(() => selectedCount(page)).toBe(3)
})

test('Select pages: odd and even are one click', async ({ page, app }) => {
  await app.tool(/^Select pages/)
  await app.dialog().getByRole('button', { name: 'Even pages' }).click()
  await expect.poll(() => selectedCount(page)).toBe(2)
})

test('duplicate, reverse and insert a blank page, each undoable', async ({ page, app }) => {
  await app.card(1).click()
  await app.tool(/^Duplicate/)
  await expect(app.cards()).toHaveCount(5)
  await app.tool(/Insert blank page/)
  await expect(app.cards()).toHaveCount(6)
  await page.keyboard.press('Escape')
  await app.tool(/Reverse page order/)
  await expect(app.card(1)).toContainText('p. 4')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z')
  await expect(app.cards()).toHaveCount(4)
  await expect(app.card(1)).toContainText('p. 1')
})

test('Find blank pages selects exactly the empty ones, and can delete them', async ({ page, app }) => {
  await app.tool(/Find blank pages/)
  await expect(app.notice()).toContainText('2 blank pages found and selected.', { timeout: 30_000 })
  await expect.poll(() => selectedCount(page)).toBe(2)
  await app.notice().getByRole('button', { name: 'Delete them' }).click()
  await expect(app.cards()).toHaveCount(2)
})

test('Split by ranges gives one PDF per range', async ({ page, app }) => {
  await app.tool(/Split by ranges/)
  await page.locator('#split-ranges').fill('1-3, 4')
  await expect(app.dialog()).toContainText('Makes 2 PDFs: 3 pages, 1 page.')
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Split', exact: true }).click())
  const parts = unzip(out.bytes)
  expect(Object.keys(parts).sort()).toEqual(['report-part-01.pdf', 'report-part-02.pdf'])
  expect(await Promise.all(Object.keys(parts).sort().map(async (n) => (await load(parts[n])).getPageCount()))).toEqual([3, 1])
})

test('Split by size keeps every part under the limit', async ({ page, app }) => {
  await app.tool(/Split by ranges/)
  await app.dialog().getByRole('radio', { name: 'By size' }).click()
  await page.locator('#split-size').fill('0.003')
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Split', exact: true }).click())
  const parts = Object.values(unzip(out.bytes))
  expect(parts.length).toBeGreaterThan(1)
  for (const bytes of parts) expect(bytes.length).toBeLessThanOrEqual(Math.round(0.003 * 1024 * 1024))
})

test('Page size for photos puts photos on A4 and leaves PDF pages alone', async ({ page, app }) => {
  await app.add('photo.jpg')
  await app.thumbnails(5)
  await app.tool(/Page size for photos/)
  await app.dialog().getByRole('radio', { name: 'A4' }).click()
  await app.dialog().getByRole('button', { name: 'Use these settings' }).click()
  expect(await pageSizes((await app.exportPdf()).bytes)).toEqual(['595x842', '595x842', '595x842', '595x842', '842x595'])
})

test('the large preview draws the page sharply, moves with the arrow keys and zooms', async ({ page, app }) => {
  await app.card(1).hover()
  await app.card(1).getByRole('button', { name: 'Enlarge page' }).click()
  const viewer = page.getByRole('dialog', { name: 'Page 1 of 4' })
  await expect(viewer).toBeVisible()
  const image = viewer.locator('img')
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalHeight), { timeout: 20_000 }).toBeGreaterThan(1000)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: 'Page 2 of 4' })).toBeVisible()
  await page.keyboard.press('+')
  await expect(page.getByRole('dialog')).toContainText('150%')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Save as images: a ZIP of JPGs at the chosen detail, turned pages turned', async ({ page, app }) => {
  await app.card(3).hover()
  await app.card(3).getByRole('button', { name: 'Rotate right' }).click()
  await app.tool(/^Images/)
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Save 4 images' }).click())
  const images = unzip(out.bytes)
  const names = Object.keys(images).sort()
  expect(names).toEqual(['report-page-01.jpg', 'report-page-02.jpg', 'report-page-03.jpg', 'report-page-04.jpg'])
  expect(names.map((n) => imageSize(images[n]).join('x'))).toEqual(['1240x1754', '1240x1754', '1754x1240', '1240x1754'])
})

test('Save as images: one page as a PNG, on white paper rather than see-through', async ({ app }) => {
  await app.card(1).click()
  await app.tool(/^Images/)
  await app.dialog().getByRole('radio', { name: 'PNG, sharpest' }).click()
  await app.dialog().getByRole('radio', { name: 'Screen' }).click()
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Save image' }).click())
  expect(out.name).toBe('report-page-01.png')
  expect(imageSize(out.bytes)).toEqual([595, 842])
  // Decoded here in Node: the site's own security policy rightly forbids decoding it from a data: address.
  const png = await loadImage(Buffer.from(out.bytes))
  const ctx = createCanvas(png.width, png.height).getContext('2d')
  ctx.drawImage(png, 0, 0)
  expect([...ctx.getImageData(2, 2, 1, 1).data]).toEqual([255, 255, 255, 255])
})

test('Extract text: reads the words, says which pages have none, copies and saves them', async ({ page, context, app, browserName }) => {
  // Only Chromium lets a test grant, and then read, the clipboard; the other engines are checked for everything else.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await app.tool(/^Text/)
  await app.dialog().getByRole('button', { name: 'Extract text' }).click()
  await expect(app.dialog().getByRole('status')).toContainText('Text found on 2 of 4 pages. 2 pages have no text', { timeout: 30_000 })
  const text = await app.dialog().getByLabel('The text').inputValue()
  expect(text).toMatch(/^--- Page 1 ---\n\nPage 1, line 1: some real text on this page\.\nPage 1, line 2:/)
  expect(text).toContain('--- Page 2 ---\n\n(No text on this page.)')
  await app.dialog().getByRole('button', { name: 'Copy' }).click()
  await expect(app.dialog().getByRole('button', { name: 'Copied' })).toBeVisible()
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  const saved = await app.download(() => app.dialog().getByRole('button', { name: 'Save as .txt' }).click())
  expect([saved.name, new TextDecoder().decode(saved.bytes)]).toEqual(['report.txt', text])
})

test('Page numbers sit at the bottom centre of each page as seen, upright on a turned page too', async ({ app }) => {
  await app.card(3).hover()
  await app.card(3).getByRole('button', { name: 'Rotate right' }).click()
  await app.tool(/Page numbers/)
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Export with page numbers' }).click())
  const pages = await seenText(out.bytes)
  pages.forEach((p, i) => {
    const label = p.items.find((it) => it.str === `Page ${i + 1} of 4`)!
    expect(label, `page ${i + 1}`).toBeDefined()
    expect(Math.abs(label.x + label.width / 2 - p.w / 2)).toBeLessThan(1.5)
    expect(p.h - label.y).toBeLessThan(45)
    expect(label.angle).toBe(0)
  })
  await expect(app.cards()).toHaveCount(4) // the pages here are unchanged
})

test('Watermark explains text it can’t draw yet, and stamps every page', async ({ page, app }) => {
  await app.tool(/Watermark/)
  await page.locator('#watermark-text').fill('गोपनीय')
  await expect(app.dialog().getByRole('alert')).toContainText('can’t draw')
  await expect(app.dialog().getByRole('button', { name: 'Export with watermark' })).toBeDisabled()
  await page.locator('#watermark-text').fill('CONFIDENTIAL')
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Export with watermark' }).click())
  const pages = await seenText(out.bytes)
  expect(pages.map((p) => p.items.filter((i) => i.str === 'CONFIDENTIAL' && i.angle === -45).length)).toEqual([1, 1, 1, 1])
})
