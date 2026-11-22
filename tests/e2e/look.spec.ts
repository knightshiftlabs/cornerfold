// How Cornerfold looks, and the choices people can make about it (Appearance).
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'
import { CHOICES } from '../../src/lib/prefs'

const KEY = 'cornerfold.look'
const look = (page: import('@playwright/test').Page, saved: Record<string, unknown>) => page.addInitScript(([k, v]) => localStorage.setItem(k as string, JSON.stringify(v)), [KEY, saved])
const html = (page: import('@playwright/test').Page) => page.locator('html')
const stored = (page: import('@playwright/test').Page) => page.evaluate((k) => localStorage.getItem(k), KEY)

test.describe('theme', () => {
  test('follows the device, dark or light', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.open()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
  })

  test('a chosen theme wins over the device, is applied at once, and is still there after a reload', async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await app.open()
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const before = await bg()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('radio', { name: 'Midnight' }).click()
    await expect(html(page)).toHaveAttribute('data-theme', 'midnight')
    expect(await bg()).not.toBe(before)
    expect(await bg()).toMatch(/^(rgb\(0, 0, 0\)|color\(srgb 0 0 0\))$/)
    await page.reload()
    await expect(html(page)).toHaveAttribute('data-theme', 'midnight')
  })

  test('the saved look is in place before the app has even started, so a reload never flashes the wrong theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await look(page, { theme: 'dark', accent: 'pink' })
    // Hold the app's own script back: whatever look the page has now comes from public/theme.js alone.
    await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
    await page.goto('/')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await expect(html(page)).toHaveAttribute('data-accent', 'pink')
    expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute('content'))).toBe('#0c0d11')
  })
})

test.describe('choices', () => {
  test('nothing is stored until something is changed, then only the change, and Reset clears it', async ({ page, app }) => {
    await app.open()
    expect(await stored(page)).toBeNull()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('radio', { name: 'Pink' }).click()
    expect(JSON.parse((await stored(page))!)).toEqual({ accent: 'pink' })
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    expect(await stored(page)).toBeNull()
    await expect(html(page)).toHaveAttribute('data-accent', 'indigo')
  })

  test('the accent recolours the main button', async ({ page, app }) => {
    await app.open()
    await app.add('report.pdf')
    await app.thumbnails(4)
    const fill = () => page.getByRole('button', { name: /^Export/ }).evaluate((el) => getComputedStyle(el).backgroundImage)
    const indigo = await fill()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('radio', { name: 'Green' }).click()
    expect(await fill()).not.toBe(indigo)
  })

  test('segmented choices and swatches work with the arrow keys', async ({ page, app }) => {
    await app.open()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('radiogroup', { name: 'Corners' }).getByRole('radio', { name: 'Soft' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(html(page)).not.toHaveAttribute('data-corners', 'soft')
    await page.getByRole('radio', { name: 'Indigo' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(html(page)).toHaveAttribute('data-accent', 'blue')
  })

  test('Escape and Done close the panel and give back the page', async ({ page, app }) => {
    await app.open()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await expect(app.dialog()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(app.dialog()).toBeHidden()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(app.dialog()).toBeHidden()
  })

  test('motion off stops animation, and calm halves it', async ({ page, app }) => {
    await app.open()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    const m = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--m').trim())
    await page.getByRole('radiogroup', { name: 'Motion' }).getByRole('radio', { name: 'Calm' }).click()
    expect(Number(await m())).toBe(0.5)
    await page.getByRole('radiogroup', { name: 'Motion' }).getByRole('radio', { name: 'Off' }).click()
    expect(Number(await m())).toBeLessThan(0.01)
  })

  test('a device set to reduce motion always wins', async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.open()
    expect(Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--m')))).toBeLessThan(0.01)
  })

  test('larger text really is larger', async ({ page, app }) => {
    await app.open()
    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
    const base = await size()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('radio', { name: 'Largest' }).click()
    expect(await size()).toBeGreaterThan(base * 1.2)
  })
})

test.describe('pages', () => {
  for (const style of ['fold', 'check', 'ring'] as const) {
    test(`selection as ${style}: chosen pages are plainly different from the others`, async ({ page, app }) => {
      await look(page, { select: style })
      await app.open()
      await app.add('report.pdf')
      await app.thumbnails(4)
      await app.card(2).click()
      const card = app.card(2).locator('.card')
      await expect(card).toHaveClass(/is-selected/)
      const clipped = await card.evaluate((el) => getComputedStyle(el).clipPath)
      if (style === 'fold') expect(clipped).toContain('polygon')
      else expect(clipped).toBe('none')
      await expect(app.card(2).locator('.sel-badge')).toBeVisible({ visible: style !== 'ring' })
      await expect(app.card(1).locator('.card')).not.toHaveClass(/is-selected/)
    })
  }

  test('the page-size slider changes how many pages fit across', async ({ page, app }) => {
    test.skip(page.viewportSize()!.width < 1024, 'the dock is for wide screens')
    await app.open()
    await app.add('report.pdf')
    await app.thumbnails(4)
    const width = () => app.card(1).evaluate((el) => el.getBoundingClientRect().width)
    const before = await width()
    await page.getByRole('slider', { name: 'Page size' }).fill('100')
    expect(await width()).toBeGreaterThan(before + 40)
  })

  test('keyboard hints can be switched off', async ({ page, app }) => {
    test.skip(page.viewportSize()!.width < 1024, 'the dock is for wide screens')
    await app.open()
    await app.add('report.pdf')
    await app.thumbnails(4)
    await expect(page.getByText('Drag to reorder')).toBeVisible()
    await page.getByRole('button', { name: 'Appearance' }).first().click()
    await page.getByRole('switch', { name: 'Keyboard hints' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Drag to reorder')).toBeHidden()
  })
})

// Contrast, in every theme and accent, on the real screens. A look nobody can read is not a look.
test.describe('contrast', () => {
  const themes = CHOICES.theme.filter((t) => t !== 'auto')
  const matrix: Record<string, unknown>[] = [
    ...themes.map((theme) => ({ theme })),
    ...CHOICES.accent.flatMap((accent) => [{ theme: 'dark', accent }, { theme: 'light', accent }]),
    ...CHOICES.desk.flatMap((desk) => [{ theme: 'dark', desk }, { theme: 'light', desk }]),
    { theme: 'dark', paper: 'bright' },
    { theme: 'light', contrast: true },
    { theme: 'dark', contrast: true },
    { theme: 'dark', glass: 0 },
    { theme: 'light', glass: 100 },
  ]
  for (const saved of matrix) {
    test(`readable with ${JSON.stringify(saved)}`, async ({ page, app }) => {
      await look(page, saved)
      await app.open()
      await app.add('report.pdf')
      await app.thumbnails(4)
      await app.card(2).click()
      const grid = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
      expect(grid.violations.map((v) => v.nodes.map((n) => `${n.target} ${n.failureSummary?.split('\n')[1] ?? ''}`)).flat(), 'the page grid').toEqual([])
      await page.getByRole('button', { name: 'Appearance' }).first().click()
      await expect(app.dialog()).toBeVisible()
      // Let the panel finish rising, so its colours are the final ones.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
      const panel = await new AxeBuilder({ page }).include('[role="dialog"]').withRules(['color-contrast']).analyze()
      expect(panel.violations.map((v) => v.nodes.map((n) => `${n.target} ${n.failureSummary?.split('\n')[1] ?? ''}`)).flat(), 'the Appearance panel').toEqual([])
    })
  }
})
