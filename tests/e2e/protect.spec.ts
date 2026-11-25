// Protect with password, end to end: the exported file is locked, opens with the password, and nothing leaves the site
// (the locking engine is WebAssembly, which the page's security policy has to allow and the guard watches).
import { test, expect } from './fixtures'
import { isEncrypted, openWith } from './pdf'

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.add('report.pdf')
  await app.thumbnails(4)
})

test('the file comes out locked, opens only with the password, and keeps its pages', async ({ page, app }) => {
  await app.tool(/Protect with password/)
  const dialog = page.getByRole('dialog', { name: 'Protect with password' })
  const lock = dialog.getByRole('button', { name: 'Lock and export' })
  await expect(lock).toBeDisabled()
  await dialog.getByLabel('Password to open the file').fill('open sesame')
  await dialog.getByLabel('Type it again').fill('open sesame!')
  await expect(dialog.getByRole('alert')).toHaveText('The two passwords are different.')
  await expect(lock).toBeDisabled()
  await dialog.getByLabel('Type it again').fill('open sesame')
  await expect(lock).toBeEnabled()
  const out = await app.download(() => lock.click())
  expect(out.name).toBe('report-protected.pdf')
  expect(await isEncrypted(out.bytes)).toBe(true)
  expect(await openWith(out.bytes)).toBe('PasswordException')
  expect(await openWith(out.bytes, 'wrong')).toBe('PasswordException')
  expect(await openWith(out.bytes, 'open sesame')).toContain('Page 1, line 1')
  await expect(dialog).toHaveCount(0)
})

test('showing the password drops the second box, and Enter locks', async ({ page, app }) => {
  await app.tool(/Protect with password/)
  const dialog = page.getByRole('dialog', { name: 'Protect with password' })
  await dialog.getByLabel('Show the password').check()
  await expect(dialog.getByLabel('Type it again')).toHaveCount(0)
  await dialog.getByLabel('Password to open the file').fill('-dash first')
  const out = await app.download(() => page.keyboard.press('Enter'))
  expect(await openWith(out.bytes, '-dash first')).toContain('Page 1, line 1')
})

test('cancelling exports nothing and closes the panel', async ({ page, app }) => {
  await app.tool(/Protect with password/)
  const dialog = page.getByRole('dialog', { name: 'Protect with password' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
})
