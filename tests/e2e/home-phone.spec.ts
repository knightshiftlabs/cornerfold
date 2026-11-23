// Small phones, the parts the toolbar test in phone.spec.ts does not reach: the home screen before any file is added,
// and the moments while pages land on the desk. Both stuck out past the screen edge at 320 pixels wide until 1.8.4
// (the home bar by 105 pixels, the landing pages by about 12), which was found because a test measured at the wrong moment.
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const width of [320, 360, 390]) {
  test(`at ${width} pixels wide the home screen fits, and its links can still be reached`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 780 })
    await app.open()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect.poll(() => overflow(page), { message: 'the home screen sticks out past the screen' }).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible()
    await expect(page.locator('footer').getByRole('link', { name: 'Privacy' })).toBeVisible()
    await expect(page.locator('footer').getByRole('link', { name: /^Cornerfold \d/ })).toBeVisible()
  })

  test(`at ${width} pixels wide nothing sticks out while pages land on the desk`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 780 })
    await app.open()
    // Every animation frame from here on: the widest the page has been.
    await page.evaluate(() => {
      const w = window as unknown as { __widest: number }
      w.__widest = 0
      const tick = () => {
        w.__widest = Math.max(w.__widest, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        requestAnimationFrame(tick)
      }
      tick()
    })
    await app.add('report.pdf')
    await app.thumbnails(4)
    await page.waitForTimeout(1500) // the landing animation, with its delays, is over by now
    expect(await page.evaluate(() => (window as unknown as { __widest: number }).__widest), 'the widest the page got while pages landed').toBeLessThanOrEqual(0)
  })
}
