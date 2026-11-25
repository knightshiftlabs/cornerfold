// Pictures in the pages, end to end: the stored pictures come out at their own size, once each, and never from a page
// with a redaction on it.
import { test, expect } from './fixtures'
import { imageSize, unzip } from './pdf'

const editor = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Fill and sign' })

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.add('scan.pdf') // three pages that are each one 2400 x 3400 photo, and a page with a 1400 x 1000 PNG that has see-through parts
  await app.thumbnails(4)
})

test('every stored picture comes out once, at its own size, as PNG, keeping its transparency', async ({ page, app }) => {
  // Page 1 twice: the same picture must not come out twice.
  await app.card(1).click()
  await app.tool(/^Duplicate/)
  await app.thumbnails(5)
  await page.keyboard.press('Escape')
  await app.tool(/Pictures in the pages/)
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Save pictures' }).click())
  expect(out.name).toBe('scan-pictures.zip')
  const files = unzip(out.bytes)
  expect(Object.keys(files).sort()).toEqual(['scan-page-01-picture-1.png', 'scan-page-03-picture-1.png', 'scan-page-04-picture-1.png', 'scan-page-05-picture-1.png'])
  expect(Object.values(files).map((b) => imageSize(b).join('x'))).toEqual(['2400x3400', '2400x3400', '2400x3400', '1400x1000'])
  expect(files['scan-page-05-picture-1.png'][25]).toBe(6) // PNG colour type 6: with an alpha channel
  await expect(app.notice()).toContainText('Saved 4 pictures')
})

test('a page with a redaction box gives no pictures, and the notice says it was skipped', async ({ page, app }) => {
  await app.tool(/Fill and sign/)
  const stageImg = editor(page).getByRole('img', { name: 'Page 1' })
  await expect(stageImg).toBeVisible({ timeout: 20_000 })
  await editor(page).getByRole('button', { name: 'Redact', exact: true }).click()
  const b = (await stageImg.locator('..').boundingBox())!
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5)
  await editor(page).getByRole('button', { name: 'Done' }).click()
  await expect(editor(page)).toHaveCount(0)
  await app.tool(/Pictures in the pages/)
  const out = await app.download(() => app.dialog().getByRole('button', { name: 'Save pictures' }).click())
  expect(Object.keys(unzip(out.bytes)).sort()).toEqual(['scan-page-02-picture-1.png', 'scan-page-03-picture-1.png', 'scan-page-04-picture-1.png'])
  await expect(app.notice()).toContainText('1 page with redactions skipped')
})
