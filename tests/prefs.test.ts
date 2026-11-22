// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHOICES, DEFAULTS, KEY, apply, load, sanitize, save, usePrefs } from '../src/lib/prefs'

const themeJs = readFileSync('public/theme.js', 'utf8')

// Our own small storage. Newer Node versions ship a built-in localStorage that throws unless started with a flag, and it
// hides the one jsdom provides, so these tests must not depend on whichever one the machine happens to have.
let failWrites = false
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('quota')
      data.set(k, String(v))
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

function mockMedia(dark: boolean, reduce = false) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') ? dark : q.includes('reduce') ? reduce : false, addEventListener() {}, removeEventListener() {} }))
}
const attrs = (root: HTMLElement) => ({ ...root.dataset, glass: root.style.getPropertyValue('--glass'), size: root.style.getPropertyValue('--size') })
const reset = () => {
  document.documentElement.removeAttribute('style')
  for (const k of Object.keys(document.documentElement.dataset)) delete document.documentElement.dataset[k]
}

beforeEach(() => {
  failWrites = false
  vi.stubGlobal('localStorage', fakeStorage())
  reset()
  mockMedia(false)
})

describe('the saved look', () => {
  it('stores nothing until something is changed', () => {
    save(DEFAULTS)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('stores only what differs, and removes the copy once everything is back to default', () => {
    save({ ...DEFAULTS, accent: 'pink', glass: 20 })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ accent: 'pink', glass: 20 })
    save(DEFAULTS)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('reads a bad or hand-edited copy setting by setting, never all-or-nothing', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'neon', accent: 'green', glass: 900, size: 'big', contrast: 'yes', sound: true }))
    expect(load()).toEqual({ ...DEFAULTS, accent: 'green', glass: 100, sound: true })
  })

  it('survives unreadable or blocked storage', () => {
    localStorage.setItem(KEY, '{not json')
    expect(load()).toEqual(DEFAULTS)
    failWrites = true
    expect(() => save({ ...DEFAULTS, theme: 'dark' })).not.toThrow()
  })

  it('ignores things that are not a look at all', () => {
    for (const junk of [null, 5, 'x', [], undefined]) expect(sanitize(junk)).toEqual(DEFAULTS)
  })
})

describe('applying a look', () => {
  it('"auto" follows the device, and only auto does', () => {
    mockMedia(true)
    apply({ ...DEFAULTS })
    expect(document.documentElement.dataset.theme).toBe('dark')
    apply({ ...DEFAULTS, theme: 'paper' })
    expect(document.documentElement.dataset.theme).toBe('paper')
  })

  it('sets and clears the high-contrast switch', () => {
    apply({ ...DEFAULTS, contrast: true })
    expect(document.documentElement.dataset.contrast).toBe('high')
    apply(DEFAULTS)
    expect(document.documentElement.dataset.contrast).toBeUndefined()
  })

  it('changing a setting applies it and saves it in one step', () => {
    usePrefs.getState().set('accent', 'orange')
    expect(document.documentElement.dataset.accent).toBe('orange')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ accent: 'orange' })
    usePrefs.getState().reset()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(document.documentElement.dataset.accent).toBe('indigo')
  })
})

describe('public/theme.js (runs before the first paint)', () => {
  const run = () => new Function(themeJs)()

  // The script and the app must always agree, or the page would flash one look and then change to another.
  const cases: Record<string, unknown>[] = [
    {},
    { theme: 'dark' },
    { theme: 'midnight', accent: 'violet', desk: 'felt' },
    { theme: 'paper', paper: 'warm', shadow: 'lifted', select: 'ring', corners: 'round', density: 'airy', motion: 'off', text: 'largest', contrast: true, glass: 5, size: 90 },
    { theme: 'neon', accent: 7, glass: -4, size: 'x' },
  ]
  for (const dark of [false, true]) {
    for (const saved of cases) {
      it(`matches the app for ${JSON.stringify(saved)} on a ${dark ? 'dark' : 'light'} device`, () => {
        mockMedia(dark)
        localStorage.setItem(KEY, JSON.stringify(saved))
        run()
        const fromScript = attrs(document.documentElement)
        reset()
        apply(load())
        expect(fromScript).toEqual(attrs(document.documentElement))
      })
    }
  }

  it('does not break the page when storage is unreadable', () => {
    localStorage.setItem(KEY, '{nope')
    expect(run).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('knows every choice the app offers', () => {
    for (const values of Object.values(CHOICES)) for (const v of values) expect(themeJs).toContain(`'${v}'`)
  })
})
