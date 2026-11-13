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

describe('the Tools menu and its panels', () => {
  const menuButton = () => $('button[aria-haspopup="menu"]') as HTMLButtonElement
  const menu = () => $('[role="menu"]')
  const item = (label: string) => $$('[role="menuitem"]').find((b) => b.textContent?.includes(label)) as HTMLButtonElement
  const panel = () => $('[role="dialog"][aria-labelledby="sheet-title"]')
  /** A button inside the open panel, so the toolbar's own buttons are never picked by mistake. */
  const button = (name: string) => [...panel()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement
  const type = async (selector: string, value: string) => {
    const input = $(selector) as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  }
  /** Waits for something to be true, instead of assuming a fixed pause is long enough (it isn't, under load). */
  const until = async (ready: () => unknown) => {
    for (let i = 0; i < 150 && !ready(); i++) await tick()
  }
  const openMenu = async () => {
    if (!menu()) menuButton().click()
    await until(() => menu() && $$('[role="menuitem"]').length)
  }
  /** Opens a tool from the menu and waits for its panel, which is loaded on demand. */
  const open = async (label: string) => {
    await openMenu()
    item(label).click()
    await until(panel)
  }
  const selectedNumbers = () => useStore.getState().pages.flatMap((p, i) => (useStore.getState().selected.has(p.id) ? [i + 1] : []))

  beforeEach(async () => {
    useStore.getState().closeTool()
    useStore.getState().deselect()
    await addFourPages()
  })
  afterEach(async () => {
    useStore.getState().closeTool()
    if (menu()) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
  })

  it('opens from the toolbar, lists the tools in groups, and closes with Escape', async () => {
    expect(menu()).toBeNull()
    await openMenu()
    await until(() => document.activeElement === $$('[role="menuitem"]')[0])
    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect($$('[role="group"]').map((g) => g.getAttribute('aria-label'))).toEqual(['Make smaller', 'Select', 'Pages', 'Photos', 'Split', 'Save as', 'Stamp']) // these tests run at phone size, so the phone-only group shows
    expect(document.activeElement).toBe($$('[role="menuitem"]')[0]) // focus goes to the first tool
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await until(() => !menu())
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(menuButton()) // and back to the button
  })

  it('moves through the tools with the arrow keys', async () => {
    await openMenu()
    const items = $$('[role="menuitem"]:not([disabled])')
    await until(() => document.activeElement === items[0]) // focus moves in once the menu has drawn
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[1])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[items.length - 1])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[0]) // wraps round
  })

  it('offers Duplicate only once something is selected, and says why', async () => {
    await openMenu()
    expect(item('Duplicate').disabled).toBe(true)
    expect(item('Duplicate').textContent).toContain('Select pages first')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await until(() => !menu())
    useStore.getState().selectOnly(['p2'])
    await openMenu()
    await until(() => !item('Duplicate').disabled)
    item('Duplicate').click()
    await until(() => useStore.getState().pages.length === 5)
    expect(useStore.getState().pages).toHaveLength(5)
  })

  it('reverses and inverts straight from the menu', async () => {
    menuButton().click()
    await tick()
    item('Reverse page order').click()
    await tick()
    expect(useStore.getState().pages.map((p) => p.id)).toEqual(['p4', 'p3', 'p2', 'p1'])
    useStore.getState().selectOnly(['p4'])
    await tick()
    menuButton().click()
    await tick()
    item('Invert selection').click()
    await tick()
    expect([...useStore.getState().selected].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('Select pages: shows what a range will select, and selects it with Enter', async () => {
    await open('Select pages')
    expect(text()).toContain('This document has 4 pages.')
    expect(document.activeElement?.id).toBe('select-ranges')
    await type('#select-ranges', '1-2, 4')
    expect(text()).toContain('Selects 3 of 4 pages.')
    $('#select-ranges')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
    expect(selectedNumbers()).toEqual([1, 2, 4])
    expect(panel()).toBeNull()
  })

  it('Select pages: explains a page that doesn’t exist, and won’t select until it is fixed', async () => {
    await open('Select pages')
    await type('#select-ranges', '2-9')
    expect($('#select-ranges-note')!.getAttribute('role')).toBe('alert')
    expect(text()).toContain('There is no page 9. This document has 4 pages.')
    expect(button('Select').disabled).toBe(true)
    expect($('#select-ranges')!.getAttribute('aria-invalid')).toBe('true')
    await type('#select-ranges', '2-4')
    expect(button('Select').disabled).toBe(false)
  })

  it('Select pages: starts from the current selection, written as ranges', async () => {
    useStore.getState().selectOnly(['p1', 'p2', 'p4'])
    await open('Select pages')
    expect(($('#select-ranges') as HTMLInputElement).value).toBe('1-2, 4')
  })

  it('Select pages: odd, even and every Nth are one click', async () => {
    await open('Select pages')
    button('Odd pages').click()
    await tick()
    expect(selectedNumbers()).toEqual([1, 3])
    await open('Select pages')
    button('Even pages').click()
    await tick()
    expect(selectedNumbers()).toEqual([2, 4])
    await open('Select pages')
    await type('#select-step', '4')
    button('Select every 4').click()
    await tick()
    expect(selectedNumbers()).toEqual([4])
  })

  it('Split: describes what each way of splitting will produce before doing it', async () => {
    await open('Split by ranges or size')
    expect(text()).toContain('Splits the whole document (4 pages) in its current order.')
    expect(button('Split').disabled).toBe(true) // nothing typed yet
    await type('#split-ranges', '1-3, 4')
    expect(text()).toContain('Makes 2 PDFs: 3 pages, 1 page.')
    expect(button('Split').disabled).toBe(false)
    await type('#split-ranges', '1-3, 9')
    expect(text()).toContain('There is no page 9. This document has 4 pages.')
    expect(button('Split').disabled).toBe(true)

    $$('[role="radio"]').find((r) => r.textContent === 'Every N pages')!.click()
    await tick()
    await type('#split-every', '3')
    expect(text()).toContain('Makes 2 PDFs of up to 3 pages each.')
    $$('[role="radio"]').find((r) => r.textContent === 'By size')!.click()
    await tick()
    await type('#split-size', '0')
    expect(text()).toContain('Type a size in MB, such as 5 or 0.5.')
    await type('#split-size', '2')
    expect(text()).toContain('as many pages in each PDF as fit under 2 MB')
    $$('[role="radio"]').find((r) => r.textContent === 'Every page')!.click()
    await tick()
    expect(text()).toContain('Makes 4 PDFs, one for each page.')
  })

  it('Page size for photos: shows the choices that matter, and keeps them only when saved', async () => {
    await open('Page size for photos')
    expect(text()).toContain('PDF pages stay as they are.')
    expect(text()).not.toContain('Margin') // only shown once a paper size is chosen
    $$('[role="radio"]').find((r) => r.textContent === 'A4')!.click()
    await tick()
    expect(text()).toContain('Margin')
    expect(text()).toContain('Orientation')
    $$('[role="radio"]').find((r) => r.textContent === 'Portrait')!.click()
    await tick()
    button('Cancel').click()
    await tick()
    expect(useStore.getState().paper.size).toBe('original') // cancelling changes nothing

    await open('Page size for photos')
    $$('[role="radio"]').find((r) => r.textContent === 'Letter')!.click()
    await tick()
    $$('[role="radio"]').find((r) => r.textContent === '2 cm')!.click()
    await tick()
    button('Use these settings').click()
    await tick()
    expect(useStore.getState().paper).toEqual({ size: 'letter', margin: 'wide', orientation: 'auto' })
    expect(useStore.getState().toast?.text).toBe('Photos will be placed on pages as Letter, turned to suit each photo, 2 cm margin when you export.')
    menuButton().click()
    await tick()
    expect(item('Page size for photos').textContent).toContain('Letter, turned to suit each photo, 2 cm margin') // the menu says what is set
    useStore.getState().setPaper({ size: 'original', margin: 'small', orientation: 'auto' })
  })

  it('Page numbers: shows what the first number will say, as the style and options change', async () => {
    await open('Page numbers')
    expect(text()).toContain('Exports all 4 pages with page numbers. Your pages here stay as they are.')
    expect(text()).toContain('The first numbered page will show “Page 1 of 4”.')
    $$('[role="radio"]').find((r) => r.textContent === '1 / 9')!.click()
    await tick()
    expect(text()).toContain('will show “1 / 4”')
    ;($('input[type="checkbox"]') as HTMLInputElement).click()
    await tick()
    expect(text()).toContain('will show “1 / 3”') // the cover isn't counted
    await type('#numbers-start', '7')
    expect(text()).toContain('will show “7 / 9”')
    await type('#numbers-start', 'x')
    expect(text()).toContain('Type a whole number, such as 1.')
    expect(button('Export with page numbers').disabled).toBe(true)
  })

  it('Page numbers and the other export tools say when they will use only the selected pages', async () => {
    useStore.getState().selectOnly(['p1', 'p3'])
    await open('Page numbers')
    expect(text()).toContain('Exports the 2 pages you selected with page numbers.')
    useStore.getState().closeTool()
    await open('Images')
    expect(text()).toContain('Saves the 2 pages you selected as images, together in one ZIP.')
    expect(button('Save 2 images')).toBeDefined()
  })

  it('Watermark: needs some text, and explains characters it can’t draw yet', async () => {
    await open('Watermark')
    expect(document.activeElement?.id).toBe('watermark-text')
    expect(button('Export with watermark').disabled).toBe(true) // nothing typed
    await type('#watermark-text', 'गोपनीय')
    expect($('#watermark-text-note')!.getAttribute('role')).toBe('alert')
    expect(text()).toContain('Watermarks can use Latin letters, numbers and common symbols for now. Cornerfold can’t draw ग ो प न ी य yet.')
    expect(button('Export with watermark').disabled).toBe(true)
    await type('#watermark-text', 'Brouillon – “final”')
    expect(button('Export with watermark').disabled).toBe(false)
    await type('#watermark-text', 'X'.repeat(61))
    expect(text()).toContain('Keep it under 60 characters')
  })

  it('Text: explains what it can and can’t read before starting', async () => {
    await open('Text')
    expect(text()).toContain('Only text that is really in the PDF can be read, not text inside photos or scans.')
    expect(button('Extract text')).toBeDefined()
  })

  it('a panel closes with Escape and keeps keyboard shortcuts off the pages behind it', async () => {
    useStore.getState().selectOnly(['p1'])
    await open('Select pages')
    await press('Backspace')
    await press('r')
    expect(useStore.getState().pages).toHaveLength(4)
    expect(useStore.getState().pages.every((p) => p.rotation === 0)).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(panel()).toBeNull()
  })
})

describe('the large preview', () => {
  const viewer = () => $('[role="dialog"][aria-label^="Page "]')
  const control = (label: string) => $(`[role="dialog"] button[aria-label="${label}"]`) as HTMLButtonElement
  const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  const enlarge = async (n: number) => {
    $$('button[aria-label="Enlarge page"]')[n - 1].click()
    for (let i = 0; i < 100 && !viewer(); i++) await tick()
  }
  beforeEach(async () => {
    useStore.getState().closeTool()
    await addFourPages()
  })
  afterEach(() => useStore.getState().closeTool())

  it('every page card has an Enlarge button, which opens that page', async () => {
    expect($$('button[aria-label="Enlarge page"]')).toHaveLength(4)
    await enlarge(2)
    expect(viewer()!.getAttribute('aria-label')).toBe('Page 2 of 4')
    expect(viewer()!.getAttribute('aria-modal')).toBe('true')
    expect(useStore.getState().selected.size).toBe(0) // opening it doesn't select the page
  })

  it('says it is drawing the page, or that it can’t be shown, rather than showing nothing', async () => {
    await enlarge(1)
    expect($('[role="dialog"] [role="status"]')!.textContent).toMatch(/Drawing the page…|This page can’t be shown\./)
  })

  it('moves between pages with the buttons and the arrow keys, and stops at the ends', async () => {
    await enlarge(1)
    expect(control('Previous page').disabled).toBe(true)
    control('Next page').click()
    await tick()
    expect(viewer()!.getAttribute('aria-label')).toBe('Page 2 of 4')
    key('ArrowRight')
    key('ArrowRight')
    await tick()
    expect(viewer()!.getAttribute('aria-label')).toBe('Page 4 of 4')
    expect(control('Next page').disabled).toBe(true)
    key('ArrowRight') // at the end: nothing happens
    await tick()
    expect(viewer()!.getAttribute('aria-label')).toBe('Page 4 of 4')
    key('ArrowLeft')
    await tick()
    expect(viewer()!.getAttribute('aria-label')).toBe('Page 3 of 4')
  })

  it('zooms in steps, back to fit with 0, and not past its limits', async () => {
    await enlarge(1)
    const level = () => viewer()!.textContent!.match(/(\d+)%/)![1]
    expect(level()).toBe('100')
    control('Zoom in').click()
    await tick()
    expect(level()).toBe('150')
    key('+')
    await tick()
    expect(level()).toBe('200')
    key('0')
    await tick()
    expect(level()).toBe('100')
    key('-')
    key('-')
    key('-')
    await tick()
    expect(level()).toBe('50')
    expect(control('Zoom out').disabled).toBe(true)
  })

  it('starts each new page at fit, not at the last page’s zoom', async () => {
    await enlarge(1)
    key('+')
    key('ArrowRight')
    await tick()
    expect(viewer()!.textContent).toContain('100%')
  })

  it('closes with Escape or the close button, and shortcuts stay off the pages while it is open', async () => {
    useStore.getState().selectOnly(['p1'])
    await enlarge(1)
    await press('Backspace')
    await press('r')
    expect(useStore.getState().pages).toHaveLength(4)
    key('Escape')
    await tick()
    expect(viewer()).toBeNull()
    await enlarge(3)
    control('Close preview').click()
    await tick()
    expect(viewer()).toBeNull()
  })

  it('closes itself if its page is deleted', async () => {
    await enlarge(2)
    useStore.getState().remove(new Set(['p2']))
    for (let i = 0; i < 20 && viewer(); i++) await tick()
    expect(viewer()).toBeNull()
  })
})

describe('the toolbar on phones', () => {
  // jsdom can't lay out a page, so the widths are checked in a real browser. This guards the cause of the
  // old bug: a plain `hidden` class loses to the buttons' own display style, so Split always showed on phones.
  it('hides buttons on phones in a way that wins over their own display style', async () => {
    await addFourPages()
    for (const label of ['Compress', 'Split into separate PDFs']) {
      const classes = $(`header button[aria-label="${label}"]`)!.className.split(/\s+/)
      expect(classes, label).toContain('max-sm:hidden')
      expect(classes, label).not.toContain('hidden')
    }
  })

  it('makes room for the selection actions by moving the logo, badge and Undo aside', async () => {
    await addFourPages()
    useStore.getState().deselect()
    await tick()
    expect($('header a[aria-label="Cornerfold home"]')!.className).not.toContain('max-sm:hidden')
    useStore.getState().selectOnly(['p1'])
    await tick()
    expect($('header a[aria-label="Cornerfold home"]')!.className).toContain('max-sm:hidden')
    expect($('header button[aria-label="Undo"]')!.className).toContain('max-sm:hidden')
    useStore.getState().deselect()
  })
})
