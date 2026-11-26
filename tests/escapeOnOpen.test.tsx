// @vitest-environment jsdom
// Windows that close with Escape must listen from the moment they are drawn. Regression: some attached their key handler
// a frame late, so an Escape in that instant was missed (a test caught it in the Compress window on a busy computer).
// Each test presses Escape the instant the window appears in the page, before anything else can run.
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }) }))
;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false, addEventListener() {} })

const root = document.createElement('div')
document.body.append(root)
afterEach(() => render(null, root))

/** Resolves once `selector` is in the page, having pressed Escape at that very moment. */
const escapeOnAppear = (selector: string) =>
  new Promise<void>((done) => {
    const watch = new MutationObserver(() => {
      if (!document.querySelector(selector)) return
      watch.disconnect()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      done()
    })
    watch.observe(document.body, { childList: true, subtree: true })
  })
const settle = () => new Promise((r) => setTimeout(r, 30))

it('the Compress window', async () => {
  const { useStore } = await import('../src/lib/store')
  const { CompressDialog } = await import('../src/components/CompressDialog')
  useStore.setState({ sources: { a: { id: 'a', name: 'r', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 1 } }, pages: [{ id: 'p', sourceId: 'a', index: 0, rotation: 0 }] } as never)
  render(<CompressDialog />, root)
  const pressed = escapeOnAppear('[role="dialog"]')
  useStore.getState().setCompressOpen(true)
  await pressed
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  useStore.getState().setCompressOpen(false)
})

it('the privacy badge’s popover', async () => {
  const { PrivacyBadge } = await import('../src/components/PrivacyBadge')
  render(<PrivacyBadge />, root)
  const pressed = escapeOnAppear('[role="dialog"]')
  document.querySelector<HTMLElement>('button[aria-expanded]')!.click()
  await pressed
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
})
