// @vitest-environment jsdom
// The real interface in a simulated browser: clicks, keys and dialogs, end to end.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }) }))

let useStore: typeof import('../src/lib/store').useStore
const tick = () => new Promise((r) => setTimeout(r, 20))
const $ = (s: string) => document.querySelector<HTMLElement>(s)
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)]
const text = () => document.body.textContent!.replace(/\s+/g, ' ')
const press = async (key: string, opts: KeyboardEventInit = {}) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
  await tick()
}
const cards = () => $$('li[aria-label^="Page"]')

beforeAll(async () => {
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  ;(window as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
  useStore = (await import('../src/lib/store')).useStore
  const App = (await import('../src/App')).default
  document.body.innerHTML = '<div id="root"></div>'
  render(<App />, document.getElementById('root')!)
  await tick()
})

beforeEach(async () => {
  useStore.setState({ sources: {}, pages: [], selected: new Set(), anchor: null, past: [], future: [], toast: null, compressOpen: false })
  await tick()
})

const addFourPages = async () => {
  useStore.getState().addPages(
    [
      { id: 's1', name: 'report', kind: 'image', bytes: new Uint8Array(4), pageCount: 1, mime: 'image/png', width: 10, height: 10 },
      { id: 's2', name: 'scan', kind: 'pdf', bytes: new Uint8Array(4), pageCount: 3 },
    ],
    [
      { id: 'p1', sourceId: 's1', index: 0, rotation: 0 },
      { id: 'p2', sourceId: 's2', index: 0, rotation: 0 },
      { id: 'p3', sourceId: 's2', index: 1, rotation: 0 },
      { id: 'p4', sourceId: 's2', index: 2, rotation: 0 },
    ],
  )
  await tick()
}

describe('home screen', () => {
  it('leads with the privacy promise and shows the version', () => {
    expect(text()).toContain('PDF tools that never see your files.')
    expect(text()).toContain('Nothing uploaded')
    expect(text()).toContain('Cornerfold test')
  })
})

describe('working with pages', () => {
  it('shows each page and a summary', async () => {
    await addFourPages()
    expect(cards()).toHaveLength(4)
    expect(text()).toContain('4 pages from 2 files')
  })

  it('selects with a click and ranges with shift-click', async () => {
    await addFourPages()
    cards()[1].click()
    await tick()
    expect(text()).toContain('1 selected')
    cards()[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await tick()
    expect($$('.card.is-selected')).toHaveLength(3)
  })

  it('rotates with R and deletes with an undo button', async () => {
    await addFourPages()
    cards()[0].click()
    await tick()
    await press('r')
    expect(useStore.getState().pages[0].rotation).toBe(90)
    await press('Delete')
    expect(cards()).toHaveLength(3)
    $$('button').find((b) => b.textContent === 'Undo')!.click()
    await tick()
    expect(cards()).toHaveLength(4)
  })

  it('ignores key presses that arrive without a page element (regression)', async () => {
    await addFourPages()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    await tick()
    expect(useStore.getState().pages.every((p) => p.rotation === 90)).toBe(true)
  })
})

describe('privacy badge', () => {
  it('says where the files are, and switches when offline', async () => {
    await addFourPages()
    const badge = () => $('button[aria-expanded]')!
    expect(badge().textContent).toContain('On this device')
    badge().click()
    await tick()
    expect(text()).toContain('Your files stay here')
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    window.dispatchEvent(new Event('offline'))
    await tick()
    expect(badge().textContent).toContain('Offline, still working')
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true })
    window.dispatchEvent(new Event('online'))
    await press('Escape')
  })
})

describe('compress panel', () => {
  const openPanel = async () => {
    await addFourPages()
    $('button[aria-label="Compress"]')!.click()
    await tick()
  }

  it('offers three levels and one-tap size limits', async () => {
    await openPanel()
    expect($('[role="dialog"]')).toBeTruthy()
    expect($$('[role="radio"]').map((b) => b.textContent!.match(/^(Light|Balanced|Smallest)/)?.[0])).toEqual(['Light', 'Balanced', 'Smallest'])
    expect($$('[role="dialog"] button').filter((b) => /KB|MB/.test(b.textContent!)).map((b) => b.textContent)).toEqual(['100 KB', '200 KB', '500 KB', '1 MB', '2 MB'])
    await press('Escape')
    expect($('[role="dialog"]')).toBeNull()
  })

  it('pauses page shortcuts while open', async () => {
    await openPanel()
    await press('r')
    expect(useStore.getState().pages.every((p) => p.rotation === 0)).toBe(true)
    await press('Escape')
  })

  it('explains bad sizes instead of ignoring them (regression)', async () => {
    await openPanel()
    const input = $('input[aria-label^="Custom size"]') as HTMLInputElement
    const submit = async (v: string) => {
      input.value = v
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await tick()
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await tick()
    }
    await submit('abc')
    expect($('#size-error')?.textContent).toMatch(/Type a size/)
    await submit('5')
    expect($('#size-error')?.textContent).toMatch(/10 KB or more/)
    await submit('1,000 KB')
    expect($('#size-error')).toBeNull()
    expect(text()).toContain('Under 1000 KB')
    await press('Escape')
  })
})
