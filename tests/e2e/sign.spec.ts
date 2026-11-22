// Fill and sign, end to end: forms filled on the page, text, signatures, ticks and crosses, with every exported
// file read back, and placements checked by drawing the exported page.
import { test, expect } from './fixtures'
import { inkAt, load, seenText } from './pdf'
import type { Page } from '@playwright/test'

const editor = (page: Page) => page.getByRole('dialog', { name: 'Fill and sign' })
const stage = (page: Page) => editor(page).getByRole('img', { name: 'Page 1' }).locator('..')

async function openOn(app: import('./fixtures').App, file: string) {
  await app.open()
  await app.add(file)
  await app.thumbnails(1)
  await app.tool(/Fill and sign/)
  await expect(editor(app.page).getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 20_000 })
}
/** Clicks the page at a point given as fractions from its top left. */
async function clickPage(page: Page, fx: number, fy: number) {
  const b = (await stage(page).boundingBox())!
  await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height)
}
async function done(page: Page) {
  await editor(page).getByRole('button', { name: 'Done' }).click()
  await expect(editor(page)).toHaveCount(0)
}
async function drawSignature(page: Page) {
  await editor(page).getByRole('button', { name: 'Signature', exact: true }).click()
  const pad = page.getByLabel('Draw your signature here')
  const b = (await pad.boundingBox())!
  await page.mouse.move(b.x + 30, b.y + 100)
  await page.mouse.down()
  for (let i = 0; i <= 24; i++) await page.mouse.move(b.x + 30 + i * 13, b.y + 100 + Math.sin(i / 2) * 35)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Use this signature' }).click()
}

test('fills every kind of form field on the page, and the export carries the answers', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByLabel('name', { exact: true }).fill('Asha Rao')
  await editor(page).getByLabel('agree', { exact: true }).check()
  await editor(page).getByLabel('plan, option 2 of 2').check()
  await editor(page).getByLabel('city', { exact: true }).selectOption('Delhi')
  await done(page)
  const form = (await load((await app.exportPdf()).bytes)).getForm()
  expect(form.getTextField('applicant.name').getText()).toBe('Asha Rao')
  expect(form.getCheckBox('agree').isChecked()).toBe(true)
  expect(form.getRadioGroup('plan').getSelected()).toBe('premium')
  expect(form.getDropdown('city').getSelected()).toEqual(['Delhi'])
})

test('locking the answers makes them part of the page: no form left, answers kept', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByLabel('name', { exact: true }).fill('Asha Rao')
  await editor(page).getByLabel('Lock the answers when exporting, so they can’t be changed').check()
  await done(page)
  const out = (await app.exportPdf()).bytes
  expect((await load(out)).getForm().getFields()).toHaveLength(0)
  expect((await seenText(out))[0].items.map((i) => i.str).join(' ')).toContain('Asha Rao')
})

test('text goes exactly where the page is clicked', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByRole('button', { name: 'Text' }).click()
  await expect(editor(page).getByRole('status')).toContainText('Click on the page where it should go')
  await clickPage(page, 0.5, 0.5)
  await page.keyboard.type('Approved')
  await page.keyboard.press('Escape')
  await done(page)
  const [p] = await seenText((await app.exportPdf()).bytes)
  const t = p.items.find((i) => i.str === 'Approved')!
  expect(t.angle).toBe(0)
  expect(Math.abs(t.x / p.w - 0.5)).toBeLessThan(0.02)
  expect(Math.abs(t.y / p.h - 0.5)).toBeLessThan(0.03)
})

test('keyboard only: add text, move it with the arrow keys, and remove it', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByRole('button', { name: 'Text' }).focus()
  await page.keyboard.press('Enter') // from the keyboard it is placed at once
  await expect(editor(page).getByLabel('Text to add')).toBeFocused()
  await page.keyboard.type('Hello')
  await page.keyboard.press('Control+Enter')
  const mark = editor(page).getByRole('button', { name: /^Text: Hello\./ })
  await mark.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await done(page)
  let [p] = await seenText((await app.exportPdf()).bytes)
  expect(p.items.find((i) => i.str === 'Hello')!.x / p.w).toBeCloseTo(0.15, 2) // placed at 0.10, moved right five times
  await app.tool(/Fill and sign/)
  await editor(page).getByRole('button', { name: /^Text: Hello\./ }).focus()
  await page.keyboard.press('Delete')
  await done(page)
  ;[p] = await seenText((await app.exportPdf()).bytes)
  expect(p.items.some((i) => i.str === 'Hello')).toBe(false)
})

test('a drawn signature lands exactly where it was placed, and nowhere else', async ({ page, app }) => {
  test.setTimeout(120_000)
  await openOn(app, 'form.pdf')
  await drawSignature(page)
  await expect(editor(page).getByRole('button', { name: /^Signature\./ })).toBeVisible()
  await expect(editor(page)).toContainText('It is not a digital signature with a certificate')
  await done(page)
  const out = (await app.exportPdf()).bytes
  // Placed at 55% across and 75% down, 30% wide. The ink is a wave across the middle of that box.
  const inside = await inkAt(out, Array.from({ length: 9 }, (_, i) => [0.57 + i * 0.03, 0.775] as [number, number]))
  expect(inside.some(Boolean)).toBe(true)
  expect(await inkAt(out, [[0.3, 0.9], [0.95, 0.775], [0.5, 0.6]])).toEqual([false, false, false])
})

test('a typed signature is written in the handwriting font, loaded from the site itself', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByRole('button', { name: 'Signature', exact: true }).click()
  await page.getByRole('radio', { name: 'Type' }).click()
  await page.getByLabel('Your name').fill('Asha Rao')
  await page.getByRole('button', { name: 'Use this signature' }).click()
  await expect(editor(page).getByRole('button', { name: /^Signature\./ })).toBeVisible()
  await done(page)
  const ink = await inkAt((await app.exportPdf()).bytes, Array.from({ length: 12 }, (_, i) => [0.56 + i * 0.025, 0.78] as [number, number]))
  expect(ink.some(Boolean)).toBe(true)
})

test('a tick and a cross go where the page is clicked', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByRole('button', { name: 'Tick' }).click()
  await clickPage(page, 0.3, 0.6)
  await editor(page).getByRole('button', { name: 'Cross' }).click()
  await clickPage(page, 0.7, 0.6)
  await done(page)
  expect(await inkAt((await app.exportPdf()).bytes, [[0.3, 0.6], [0.7, 0.6], [0.5, 0.6]])).toEqual([true, true, false])
})

test('characters the PDF font can’t draw are refused with a clear message, in text and in fields', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByLabel('name', { exact: true }).fill('गोपनीय')
  await expect(editor(page).getByRole('alert')).toContainText('can’t write')
  await expect(editor(page).getByLabel('name', { exact: true })).toHaveValue('')
})

test('Undo takes back a placed mark', async ({ page, app }) => {
  await openOn(app, 'form.pdf')
  await editor(page).getByRole('button', { name: 'Tick' }).click()
  await clickPage(page, 0.3, 0.6)
  await done(page)
  await page.keyboard.press('Control+z')
  expect(await inkAt((await app.exportPdf()).bytes, [[0.3, 0.6]])).toEqual([false])
})

test('a signature is kept nowhere the browser stores things, and is gone when the tab closes', async ({ page, app }) => {
  test.setTimeout(120_000)
  await openOn(app, 'form.pdf')
  await drawSignature(page)
  await done(page)
  await app.exportPdf()
  const stored = await page.evaluate(async () => {
    const found: string[] = []
    if (localStorage.length) found.push(`localStorage: ${localStorage.length} items`)
    if (sessionStorage.length) found.push(`sessionStorage: ${sessionStorage.length} items`)
    if (document.cookie) found.push('cookies')
    const dbs = (await indexedDB.databases?.()) ?? []
    if (dbs.length) found.push(`IndexedDB: ${dbs.map((d) => d.name).join(', ')}`)
    // The offline cache holds only the app's own files, never anything made in the app.
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) if (!new URL(req.url).pathname.match(/^\/(assets\/|fonts\/|[\w.-]+\.(js|css|html|svg|png|webmanifest|txt)$|$)/)) found.push(`cache: ${req.url}`)
    return found
  })
  expect(stored).toEqual([])
})
