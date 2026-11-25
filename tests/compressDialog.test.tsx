// @vitest-environment jsdom
// The Compress window answers Escape from the moment it is on screen. Regression: its key handler was attached a frame
// late, so on a busy machine a test's Escape arrived first and the window stayed open.
import { expect, it, vi } from 'vitest'
import { render } from 'preact'
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }) }))
;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false, addEventListener() {} })
it('closes on an Escape pressed the instant the window appears', async () => {
  const { useStore } = await import('../src/lib/store')
  const { CompressDialog } = await import('../src/components/CompressDialog')
  const root = document.createElement('div')
  document.body.append(root)
  useStore.setState({ sources: { a: { id: 'a', name: 'r', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 1 } }, pages: [{ id: 'p', sourceId: 'a', index: 0, rotation: 0 }] } as never)
  render(<CompressDialog />, root)
  // Press Escape the moment the window is in the page, before anything else can run.
  const pressed = new Promise<void>((done) => {
    const watch = new MutationObserver(() => {
      if (!document.querySelector('[role="dialog"]')) return
      watch.disconnect()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      done()
    })
    watch.observe(document.body, { childList: true, subtree: true })
  })
  useStore.getState().setCompressOpen(true)
  await pressed
  await new Promise((r) => setTimeout(r, 30))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
