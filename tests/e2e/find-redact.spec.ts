// Find and redact, end to end: search every page, add boxes over the matches, and what they cover is gone from the exported file.
import { test, expect } from './fixtures'
import { inkAt, seenText } from './pdf'
import type { Page } from '@playwright/test'

const editor = (page: Page) => page.getByRole('dialog', { name: 'Fill and sign' })
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find and redact' })

async function openFinder(app: import('./fixtures').App) {
  const { page } = app
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
  await app.tool(/Fill and sign/)
  await expect(editor(page).getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 20_000 })
  await editor(page).getByRole('button', { name: 'Find and redact' }).click()
  await expect(finder(page)).toBeVisible()
}

test('searching lists every match, and the ticked ones become redactions that are really gone from the export', async ({ app }) => {
  const { page } = app
  await openFinder(app)
  // The word is on every page that has text, so there are matches on two pages.
  await finder(page).getByLabel('Words to find').fill('line 2:')
  await finder(page).getByRole('button', { name: 'Find', exact: true }).click()
  await expect(finder(page).getByRole('status')).toContainText('2 matches on 2 pages.', { timeout: 20_000 })
  // Leave only the one on page 3 ticked.
  await finder(page).getByRole('button', { name: 'Untick all' }).click()
  await finder(page).getByRole('listitem').filter({ hasText: 'Page 3' }).getByRole('checkbox').check()
  await finder(page).getByRole('button', { name: 'Add 1 redaction' }).click()
  await expect(finder(page)).toHaveCount(0)
  await editor(page).getByRole('button', { name: 'Done' }).click()
  await expect(editor(page)).toHaveCount(0)

  const out = (await app.exportPdf()).bytes
  const text = await seenText(out)
  expect(text[2].items).toHaveLength(0) // page 3 is a picture now
  expect(text[0].items.length).toBeGreaterThan(0) // page 1 was not touched
  // Page 3, line 2 sits 86 points down the 842 point page, its words from 60 points across. Black where "line 2:" was.
  const [on] = await inkAt(out, [[(60 + 22) / 595, 82 / 842]], 3)
  expect(on).toBe(true)
  // The box is a box, not a picture-wide smear: the lines above and below it still show their own words (ink), and only
  // their neighbouring words' pixels differ. Here, simply that the box is not a whole-page cover.
  const wide = await inkAt(out, [[0.9, 82 / 842], [0.5, 0.95]], 3)
  expect(wide).toEqual([false, false])
})

test('searching for something absent says so and adds nothing', async ({ app }) => {
  const { page } = app
  await openFinder(app)
  await finder(page).getByLabel('Words to find').fill('zebra crossing')
  await page.keyboard.press('Enter')
  await expect(finder(page).getByRole('status')).toHaveText('No matches.', { timeout: 20_000 })
  await expect(finder(page).getByRole('button', { name: /^Add/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(finder(page)).toHaveCount(0)
  await expect(editor(page)).toBeVisible() // Escape closed only the search
})

test('whole words and capitals can be insisted on', async ({ app }) => {
  const { page } = app
  await openFinder(app)
  const find = finder(page)
  await find.getByLabel('Words to find').fill('LINE 1')
  await find.getByRole('button', { name: 'Find', exact: true }).click()
  // "line 1" through "line 19" on each of two pages: 11 on each page.
  await expect(find.getByRole('status')).toContainText('22 matches on 2 pages.', { timeout: 20_000 })
  await find.getByLabel('Whole words only').check()
  await find.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(find.getByRole('status')).toContainText('2 matches on 2 pages.', { timeout: 20_000 })
  await find.getByLabel('Match capitals').check()
  await find.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(find.getByRole('status')).toHaveText('No matches.', { timeout: 20_000 })
})
