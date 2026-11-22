// Redaction, end to end: what a box covers must be gone from the exported file, not just hidden.
import { test, expect } from './fixtures'
import { inkAt, pageSizes, seenText } from './pdf'
import type { Page } from '@playwright/test'

const editor = (page: Page) => page.getByRole('dialog', { name: 'Fill and sign' })
const stage = (page: Page) => editor(page).getByRole('img', { name: 'Page 1' }).locator('..')

/** Opens report.pdf in the editor and draws a box over its first three lines of text (about 8% to 62% across, 6% to 13.5% down). */
async function redactTopOfPageOne(app: import('./fixtures').App) {
  const { page } = app
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
  await app.tool(/Fill and sign/)
  await expect(editor(page).getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 20_000 })
  await editor(page).getByRole('button', { name: 'Redact' }).click()
  const b = (await stage(page).boundingBox())!
  const at = (fx: number, fy: number) => [b.x + fx * b.width, b.y + fy * b.height] as const
  await page.mouse.click(...at(0.23, 0.08)) // a 30% x 4% box, centred here: 8% to 38% across, 6% to 10% down
  const corner = at(0.38, 0.1)
  await page.mouse.move(...corner)
  await page.mouse.down()
  await page.mouse.move(...at(0.5, 0.12), { steps: 6 })
  await page.mouse.move(...at(0.62, 0.135), { steps: 6 })
  await page.mouse.up()
  await editor(page).getByRole('button', { name: 'Done' }).click()
  await expect(editor(page)).toHaveCount(0)
}

test('the text under a redaction is gone from the exported file, and the rest of the document is untouched', async ({ app }) => {
  await redactTopOfPageOne(app)
  const out = (await app.exportPdf()).bytes
  expect(await pageSizes(out)).toEqual(['595x842', '595x842', '595x842', '595x842'])
  const text = await seenText(out)
  // Page 1 is now a picture: none of its text is left, not even the lines the box did not touch.
  expect(text[0].items).toHaveLength(0)
  // The other pages keep their text, selectable as before.
  expect(text[2].items.map((i) => i.str).join(' ')).toContain('Page 3, line 1')
  // The box is black on the page, and the page is otherwise as it was.
  const [covered, uncovered] = await inkAt(out, [[0.3, 0.1], [0.3, 0.02]])
  expect(covered).toBe(true)
  expect(uncovered).toBe(false)
  // Line 17 sits about 49% down. Its words are still there, as a picture: ink somewhere along it.
  const along = await inkAt(out, Array.from({ length: 40 }, (_, i) => [0.11 + i * 0.01, 0.489] as [number, number]))
  expect(along.some(Boolean)).toBe(true)
})
