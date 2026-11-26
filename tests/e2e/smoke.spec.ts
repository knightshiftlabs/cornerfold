// The site as served: the security headers really arrive, and every page loads under them.
import { test, expect } from './fixtures'

test('the app opens under the real security headers', async ({ page, app }) => {
  const response = await page.goto('/')
  const headers = response!.headers()
  expect(headers['content-security-policy']).toContain("default-src 'none'")
  expect(headers['content-security-policy']).toContain("connect-src 'self'")
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  await app.open()
  await expect(page).toHaveTitle(/Cornerfold/)
})

for (const path of ['/privacy', '/terms', '/about', '/changes', '/verify', '/support', '/licenses.txt', '/.well-known/security.txt']) {
  test(`${path} loads`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response!.status()).toBe(200)
    await expect(page.locator('body')).not.toBeEmpty()
  })
}

// Promised on the Check our claims page.
test('using the app sets no cookies, and no response tries to', async ({ page, context, app }) => {
  const setCookie: string[] = []
  page.on('response', (r) => r.headers()['set-cookie'] && setCookie.push(r.url()))
  await app.open()
  await app.add('report.pdf', 'photo.jpg')
  await app.thumbnails(5)
  await app.exportPdf()
  expect(await context.cookies()).toEqual([])
  expect(await page.evaluate(() => document.cookie)).toBe('')
  expect(setCookie).toEqual([])
})
