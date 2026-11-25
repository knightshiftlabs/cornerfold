// A one-off probe, not part of the suite: which image formats can this browser itself decode, and what does
// Cornerfold do with each one when it is added alone? Run: npx playwright test probe-images --project=webkit
import { test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = join(process.cwd(), 'test-results', 'files')
const CASES = [
  ['photo.webp', 'image/webp'],
  ['photo.bmp', 'image/bmp'],
  ['dot.gif', 'image/gif'],
  ['sticker.png', 'image/png'],
  ['photo.jpg', 'image/jpeg'],
] as const

test('probe: browser decoding and Cornerfold, one format at a time', async ({ page, browserName }) => {
  const lines: string[] = [`browser: ${browserName}`]
  await page.goto('/')
  for (const [name, type] of CASES) {
    const base64 = readFileSync(join(FILES, name)).toString('base64')
    const direct = await page.evaluate(
      async ([b64, mime]) => {
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          const bmp = await createImageBitmap(new Blob([bytes], { type: mime }))
          return `decodes (${bmp.width}x${bmp.height})`
        } catch (e) {
          return `REFUSES: ${(e as Error).name}: ${(e as Error).message}`
        }
      },
      [base64, type],
    )
    // Then through the app itself, in a fresh page so one file cannot affect the next.
    const fresh = await page.context().newPage()
    await fresh.goto('/')
    const [chooser] = await Promise.all([fresh.waitForEvent('filechooser'), fresh.getByRole('button', { name: /^(Choose files|Add files)$/ }).first().click()])
    await chooser.setFiles(join(FILES, name))
    let app = 'nothing happened within 8s'
    for (let i = 0; i < 32; i++) {
      await fresh.waitForTimeout(250)
      const pages = await fresh.locator('li[aria-label^="Page "]').count()
      const note = (await fresh.locator('[role="status"][aria-live="polite"]').first().textContent().catch(() => ''))?.trim()
      if (pages) { app = `added as ${pages} page(s)`; break }
      if (note) { app = `notice: "${note}"`; break }
    }
    await fresh.close()
    lines.push(`${name.padEnd(12)} browser: ${direct.padEnd(44)} Cornerfold: ${app}`)
  }
  console.log('\n' + lines.join('\n') + '\n')
})
