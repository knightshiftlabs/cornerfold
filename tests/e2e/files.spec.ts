// Getting files in: the picker, every supported image type, drag and drop, paste, and files that can't be used.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, FILES } from './fixtures'
import { pageSizes } from './pdf'

test.beforeEach(async ({ app }) => app.open())

test('the file picker adds PDFs and photos, and every page is drawn', async ({ app }) => {
  await app.add('report.pdf', 'photo.jpg')
  await app.thumbnails(5)
  await expect(app.card(5)).toContainText('photo')
})

test('WebP, PNG with transparency, BMP and GIF all become pages, and export', async ({ app }) => {
  await app.add('photo.webp', 'sticker.png', 'photo.bmp', 'dot.gif')
  await app.thumbnails(4)
  const out = await app.exportPdf()
  expect(await pageSizes(out.bytes)).toEqual(['900x675', '450x450', '180x135', '1x1'])
})

/** Builds files in the page, as a browser does for a real drop or paste. */
const inPage = (name: string, type: string) => ({ name, type, base64: readFileSync(join(FILES, name)).toString('base64') })

test('dropping files onto the page adds them, with a drop target while dragging', async ({ page, app }) => {
  const files = [inPage('report.pdf', 'application/pdf'), inPage('photo.jpg', 'image/jpeg')]
  const transfer = await page.evaluateHandle((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
    return dt
  }, files)
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer })
  await expect(page.getByText(/drop/i).first()).toBeVisible()
  await page.dispatchEvent('body', 'dragover', { dataTransfer: transfer })
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer })
  await app.thumbnails(5)
})

test('pasting an image adds it as a page', async ({ page, app }) => {
  const file = inPage('photo.jpg', 'image/jpeg')
  await page.evaluate((f) => {
    const dt = new DataTransfer()
    dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
    dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
  }, file)
  await app.thumbnails(1)
})

test('a file that is not a PDF or an image is named in the explanation, and not added', async ({ app }) => {
  await app.add('notes.txt')
  await expect(app.notice()).toHaveText('notes.txt isn’t a PDF or an image.')
  await expect(app.cards()).toHaveCount(0)
})

test('a damaged PDF is named in the explanation, and the other files still go in', async ({ app }) => {
  await app.add('damaged.pdf', 'report.pdf')
  await expect(app.notice()).toContainText('damaged.pdf')
  await app.thumbnails(4)
})

test('Ctrl+O opens the file picker', async ({ page, app }) => {
  await app.add('report.pdf')
  await app.thumbnails(4)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')])
  expect(chooser.isMultiple()).toBe(true)
})
