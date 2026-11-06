// @vitest-environment jsdom
// The real interface in a simulated browser: clicks, keys and dialogs, end to end.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('offers a Report a problem link that fills in the version (and sends nothing itself)', () => {
    const link = $$('a').find((a) => a.textContent === 'Report a problem') as HTMLAnchorElement
    expect(link).toBeTruthy()
    const href = link.getAttribute('href')!
    expect(href.startsWith('mailto:hello@cornerfold.org?subject=')).toBe(true)
    expect(decodeURIComponent(href)).toContain('Cornerfold test')
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
    expect(text()).toContain('High quality that fits the limit') // regression: it used to promise "the best quality"
    expect(text()).not.toContain('best quality')
    await press('Escape')
  })
})

describe('the password dialog', () => {
  let askPassword: typeof import('../src/lib/passwords').askPassword
  let askRestricted: typeof import('../src/lib/passwords').askRestricted
  let usePrompt: typeof import('../src/lib/passwords').usePrompt
  beforeAll(async () => {
    ;({ askPassword, askRestricted, usePrompt } = await import('../src/lib/passwords'))
  })
  afterEach(async () => {
    usePrompt.getState().prompt?.answer(null) // never leave a question open for the next test
    await tick()
  })

  const dialog = () => $('[role="dialog"][aria-labelledby="lock-title"]')
  const field = () => $('#lock-password') as HTMLInputElement
  const button = (name: string) => $$('button').find((b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name) as HTMLButtonElement
  const type = async (value: string) => {
    field().value = value
    field().dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  }

  it('is not on screen until a file needs it', () => {
    expect(dialog()).toBeNull()
  })

  it('asks for the password with the field ready, and keeps Unlock off until something is typed', async () => {
    const answer = askPassword('statement.pdf', false)
    await ready()
    expect(text()).toContain('Password needed')
    expect(text()).toContain('statement.pdf')
    expect(document.activeElement?.id).toBe('lock-password')
    expect(button('Unlock').disabled).toBe(true)
    await type('secret')
    expect(button('Unlock').disabled).toBe(false)
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await answer).toBe('secret')
    await tick()
    expect(dialog()).toBeNull()
  })

  it('is announced as a modal dialog with a title and a description', async () => {
    const answer = askPassword('statement.pdf', false)
    await tick()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect($(`#${dialog()!.getAttribute('aria-labelledby')}`)!.textContent).toBe('Password needed')
    expect($(`#${dialog()!.getAttribute('aria-describedby')}`)!.textContent).toContain('statement.pdf')
    usePrompt.getState().prompt!.answer(null)
    await answer
  })

  it('leaves no trace of the password on the page once it has been answered', async () => {
    const answer = askPassword('statement.pdf', false)
    await tick()
    await type('correct horse')
    button('Unlock').click()
    await answer
    await tick()
    expect($$('input').some((i) => i.value.includes('correct horse'))).toBe(false)
    expect(document.body.innerHTML).not.toContain('correct horse')
  })

  it('says so when the previous password was wrong, and not otherwise', async () => {
    const first = askPassword('statement.pdf', false)
    await tick()
    expect($('#lock-error')).toBeNull()
    usePrompt.getState().prompt!.answer(null)
    await first
    const second = askPassword('statement.pdf', true)
    await tick()
    expect($('#lock-error')!.getAttribute('role')).toBe('alert')
    expect($('#lock-error')!.textContent).toMatch(/That password didn’t work/)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    usePrompt.getState().prompt!.answer(null)
    await second
  })

  it('shows and hides the password when asked', async () => {
    const answer = askPassword('statement.pdf', false)
    await tick()
    expect(field().type).toBe('password')
    button('Show password').click()
    await tick()
    expect(field().type).toBe('text')
    button('Hide password').click()
    await tick()
    expect(field().type).toBe('password')
    usePrompt.getState().prompt!.answer(null)
    await answer
  })

  /** The dialog is ready once its effects have run: the field has focus and the key handlers are in place. */
  const ready = async () => {
    for (let i = 0; i < 50 && document.activeElement?.id !== 'lock-password'; i++) await tick()
  }

  it('lets the person skip the file, with the button or with Escape', async () => {
    const byButton = askPassword('a.pdf', false)
    await ready()
    button('Skip this file').click()
    expect(await byButton).toBeNull()
    await tick()
    const byKey = askPassword('b.pdf', false)
    await ready()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await byKey).toBeNull()
  })

  it('asks before making an editable copy of a restricted file, and says what that means', async () => {
    const yes = askRestricted('bank.pdf')
    await tick()
    expect(text()).toContain('Make an editable copy?')
    expect(text()).toContain('bank.pdf')
    expect(text()).toContain('restricted editing or printing')
    expect(text()).toContain('Only do this for documents you’re allowed to change')
    expect(field()).toBeNull()
    button('Make editable copy').click()
    expect(await yes).toBe(true)
    await tick()
    const no = askRestricted('bank.pdf')
    await tick()
    button('Skip this file').click()
    expect(await no).toBe(false)
  })

  it('keeps Tab inside the dialog', async () => {
    const answer = askPassword('statement.pdf', false)
    await ready()
    await type('x')
    const order = $$('[role="dialog"] button:not([disabled]), [role="dialog"] input')
    const [first, last] = [order[0], order[order.length - 1]]
    last.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(first)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(last)
    usePrompt.getState().prompt!.answer(null)
    await answer
  })

  it('stops keyboard shortcuts from acting on the pages behind it (regression: R rotates, Backspace deletes)', async () => {
    await addFourPages()
    useStore.getState().select('p1', 'toggle')
    const answer = askPassword('statement.pdf', false)
    await tick()
    await press('r')
    await press('Backspace')
    expect(useStore.getState().pages).toHaveLength(4)
    expect(useStore.getState().pages.every((p) => p.rotation === 0)).toBe(true)
    usePrompt.getState().prompt!.answer(null)
    await answer
    await tick()
    await press('r') // and they work again afterwards
    expect(useStore.getState().pages.some((p) => p.rotation !== 0)).toBe(true)
  })
})
