// Arranging pages: dragging with a mouse or the keyboard, rotating, deleting, selecting, undo and redo.
import { test, expect } from './fixtures'
import { rotations } from './pdf'

/** The source label of each card, in order: "report, p. 1" and so on. */
const order = (page: import('@playwright/test').Page) =>
  page.locator('li[aria-label^="Page "]').evaluateAll((cards) => cards.map((c) => (c.textContent ?? '').match(/p\. (\d+)/)?.[1] ?? '?').join(''))

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
})

test('dragging a page with the mouse moves it', async ({ page, app }) => {
  const from = (await app.card(1).boundingBox())!
  const to = (await app.card(3).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2 + 10, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => order(page)).toBe('2314')
})

test('a page can be moved with the keyboard alone', async ({ page, app }) => {
  await app.card(1).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect.poll(() => order(page)).toBe('2134')
})

test('rotate, delete, undo and redo, and the export matches what is on screen', async ({ page, app }) => {
  await app.card(2).hover()
  await app.card(2).getByRole('button', { name: 'Rotate right' }).click()
  await app.card(4).hover()
  await app.card(4).getByRole('button', { name: 'Delete page' }).click()
  await expect(app.cards()).toHaveCount(3)
  await page.keyboard.press('Control+z')
  await expect(app.cards()).toHaveCount(4)
  await page.keyboard.press('Control+Shift+z')
  await expect(app.cards()).toHaveCount(3)
  expect(await rotations((await app.exportPdf()).bytes)).toEqual([0, 90, 0])
})

test('select with a click, a range with Shift, everything with Ctrl+A; Escape clears', async ({ page, app }) => {
  await app.card(1).click()
  await app.card(3).click({ modifiers: ['Shift'] })
  await expect(page.getByText('3 selected')).toBeVisible()
  await page.keyboard.press('Control+a')
  await expect(page.getByText('4 selected')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText(/selected$/)).toHaveCount(0)
})

test('only the selected pages are exported, and Delete removes them', async ({ page, app }) => {
  await app.card(2).click()
  await app.card(4).click({ modifiers: ['Control'] })
  const out = await app.download(() => page.getByRole('button', { name: /^Export/ }).first().click())
  expect((await rotations(out.bytes)).length).toBe(2)
  await page.keyboard.press('Delete')
  await expect(app.cards()).toHaveCount(2)
})
