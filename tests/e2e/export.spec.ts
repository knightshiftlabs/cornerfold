// Getting files out: merged exports, splitting, compression, and what the files carry with them.
import { test, expect } from './fixtures'
import { info, load, pageSizes, unzip } from './pdf'

test.beforeEach(async ({ app }) => app.open())

test('export keeps every page in order at its own size, photos included', async ({ app }) => {
  await app.add('mixed-sizes.pdf', 'photo.jpg')
  await app.thumbnails(5)
  const out = await app.exportPdf()
  expect(out.name).toMatch(/\.pdf$/)
  expect(await pageSizes(out.bytes)).toEqual(['595x842', '612x792', '1191x842', '252x144', '900x675'])
})

test('the exported file carries no title, author, software name or dates', async ({ app }) => {
  await app.add('report.pdf')
  await app.thumbnails(4)
  expect(await info((await app.exportPdf()).bytes)).toEqual({ title: undefined, producer: undefined, author: undefined, creator: undefined, xmp: false })
})

test('split into separate PDFs gives one file per page in a ZIP', async ({ page, app }) => {
  await app.add('report.pdf')
  await app.thumbnails(4)
  const out = await app.download(() => page.getByRole('button', { name: 'Split into separate PDFs' }).click())
  const parts = unzip(out.bytes)
  expect(Object.keys(parts).sort()).toEqual(['report-p01.pdf', 'report-p02.pdf', 'report-p03.pdf', 'report-p04.pdf'])
  for (const bytes of Object.values(parts)) expect((await load(bytes)).getPageCount()).toBe(1)
})

/** The size a compression level shows, in bytes, once it has been worked out. */
async function shownSize(level: import('@playwright/test').Locator) {
  await expect(level).toContainText(/\d+(\.\d+)?\s?(KB|MB)/, { timeout: 120_000 })
  const [, n, unit] = (await level.textContent())!.match(/(\d+(?:\.\d+)?)\s?(KB|MB)/)!
  return Number(n) * (unit === 'MB' ? 1024 * 1024 : 1024)
}

test('compression shows each level’s real size before download, and delivers exactly that', async ({ page, app }) => {
  test.setTimeout(180_000)
  await app.add('scan-small.pdf')
  await app.thumbnails(2)
  await page.getByRole('button', { name: 'Compress' }).click()
  const levels = page.getByRole('radiogroup', { name: 'Compression level' }).getByRole('radio')
  const smallest = levels.filter({ hasText: 'Smallest' })
  const shown = await shownSize(smallest)
  await smallest.click()
  const out = await app.download(() => page.getByRole('button', { name: /^Download/ }).click())
  expect(Math.abs(out.bytes.length - shown) / shown).toBeLessThan(0.06) // the label is rounded
  expect((await load(out.bytes)).getPageCount()).toBe(2)
})

// Slow by nature: it compresses repeatedly to home in on the limit, which takes over a minute for two pages on a
// slow machine. A known performance problem, measured in the benchmarks; this waits as long as it takes.
test('fit under a size limit delivers a file under that limit', async ({ page, app }) => {
  test.setTimeout(300_000)
  await app.add('scan-small.pdf')
  await app.thumbnails(2)
  await page.getByRole('button', { name: 'Compress' }).click()
  const smallest = await shownSize(page.getByRole('radiogroup', { name: 'Compression level' }).getByRole('radio').filter({ hasText: 'Smallest' }))
  const limitKb = Math.ceil((smallest * 1.3) / 1024)
  await page.getByLabel('Custom size limit, in KB or MB').fill(`${limitKb} KB`)
  await page.getByLabel('Custom size limit, in KB or MB').press('Enter')
  const out = await app.download(async () => {
    await expect(page.getByRole('button', { name: /^Download \d/ })).toBeEnabled({ timeout: 240_000 })
    await page.getByRole('button', { name: /^Download/ }).click()
  }, 250_000)
  expect(out.bytes.length).toBeLessThanOrEqual(limitKb * 1024)
})
