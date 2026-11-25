// Find and redact on a phone: the dialog has to fit the screen, with the keyboard-sized room left for the list.
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

const editor = (page: Page) => page.getByRole('dialog', { name: 'Fill and sign' })
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find and redact' })

test('the search dialog fits a phone and still reaches its buttons', async ({ page, app }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
  await app.tool(/Fill and sign/)
  await expect(editor(page).getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 20_000 })
  await editor(page).getByRole('button', { name: 'Find and redact' }).click()
  await finder(page).getByLabel('Words to find').fill('line 1')
  await finder(page).getByRole('button', { name: 'Find', exact: true }).click()
  await expect(finder(page).getByRole('status')).toContainText('matches on 2 pages.', { timeout: 20_000 })
  const box = (await finder(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  expect(box.y + box.height).toBeLessThanOrEqual(640)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  // Its footer buttons are on screen.
  await expect(finder(page).getByRole('button', { name: 'Cancel' })).toBeInViewport()
  await expect(finder(page).getByRole('button', { name: /^Add \d+ redactions$/ })).toBeInViewport()
})
