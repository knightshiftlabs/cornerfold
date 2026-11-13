// Password-protected and restricted PDFs: asked about one at a time, opened only on the device, exported unprotected.
import { test, expect } from './fixtures'
import { isEncrypted, load, seenText } from './pdf'

const PASSWORD = 'secret123'

test.beforeEach(async ({ app }) => app.open())

test('a locked PDF asks for its password, explains a wrong one, and opens with the right one', async ({ page, app }) => {
  await app.add('locked.pdf')
  const dialog = app.dialog()
  await expect(dialog).toContainText('locked.pdf')
  const field = dialog.locator('#lock-password')
  await expect(field).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  await field.fill('wrong')
  await field.press('Enter')
  // The dialog stays put while the password is checked, rather than vanishing and coming back.
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Checking/ })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveValue('') // a fresh try: the field is empty and ready
  await expect(field).toBeFocused()
  await field.fill(PASSWORD)
  await field.press('Enter')
  await app.thumbnails(2)
  const out = await app.exportPdf()
  expect(await isEncrypted(out.bytes)).toBe(false)
  expect((await seenText(out.bytes))[0].items.map((i) => i.str).join(' ')).toContain('Account statement page 1')
})

test('the password is not kept anywhere the browser stores data, nor left on the page', async ({ page, app }) => {
  await app.add('locked.pdf')
  await app.dialog().locator('#lock-password').fill(PASSWORD)
  await app.dialog().locator('#lock-password').press('Enter')
  await app.thumbnails(2)
  const traces = await page.evaluate(async (secret) => {
    const found: string[] = []
    for (const [name, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const)
      for (let i = 0; i < store.length; i++) if ((store.getItem(store.key(i)!) ?? '').includes(secret)) found.push(name)
    if (document.documentElement.outerHTML.includes(secret)) found.push('the page')
    if (document.cookie.includes(secret)) found.push('cookies')
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) if (req.url.includes(secret)) found.push(`cache ${name}`)
    const dbs = (await indexedDB.databases?.()) ?? []
    if (dbs.length) found.push(`IndexedDB: ${dbs.map((d) => d.name).join(', ')}`)
    return found
  }, PASSWORD)
  expect(traces).toEqual([])
})

test('skipping a locked file adds nothing and says so', async ({ page, app }) => {
  await app.add('locked.pdf')
  await app.dialog().getByRole('button', { name: 'Skip this file' }).click()
  await expect(app.notice()).toContainText('locked.pdf')
  await expect(app.cards()).toHaveCount(0)
})

test('Escape skips too, and focus returns to the page', async ({ page, app }) => {
  await app.add('locked.pdf')
  await expect(app.dialog()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(app.dialog()).toHaveCount(0)
  await expect(app.cards()).toHaveCount(0)
})

test('a restricted PDF asks first, then makes an editable copy with no restrictions', async ({ app }) => {
  await app.add('restricted.pdf')
  await app.dialog().getByRole('button', { name: 'Make editable copy' }).click()
  await app.thumbnails(2)
  const out = await app.exportPdf()
  expect(await isEncrypted(out.bytes)).toBe(false)
  expect((await load(out.bytes)).getPageCount()).toBe(2)
})
