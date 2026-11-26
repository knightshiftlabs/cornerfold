import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

// The pages that are not the app share one look and one bar, and Geist is the same file the app uses.
const read = (p: string) => readFileSync(p, 'utf8')
const pages = ['about', 'privacy', 'terms', 'verify']
const header = (html: string) => html.match(/<header class="bar">[\s\S]*?<\/header>/)?.[0] ?? ''

describe('the site pages', () => {
  it.each(pages)('%s has the shared look, the bar, and nothing inline', (name) => {
    const html = read(`public/${name}.html`)
    expect(html).toContain('<link rel="stylesheet" href="/look.css" />')
    expect(html).toContain('<script src="/theme.js"></script>')
    expect(header(html)).toContain(`aria-current="page"`)
    expect(html).not.toMatch(/<style|style=|<script(?![^>]*src=)/i)
  })

  it('every page has the same bar, apart from which link marks the page you are on', () => {
    const generated = read('scripts/changelog.mjs')
    const bars = [...pages.map((n) => header(read(`public/${n}.html`))), header(generated), header(read('public/support.html'))].map((h) => h.replace(/ aria-current="page"/, ''))
    expect(new Set(bars).size).toBe(1)
    expect(bars[0]).toContain('/about.html')
    expect(bars[0]).toContain('/verify.html')
  })

  it('each page marks exactly its own link', () => {
    for (const n of pages) {
      const marked = header(read(`public/${n}.html`)).match(/<a href="([^"]+)" aria-current="page">/g) ?? []
      expect(marked, n).toEqual([`<a href="/${n}.html" aria-current="page">`])
    }
  })

  it('the pages use the Geist files in public/fonts, which are the ones the app is built with', () => {
    for (const f of ['geist-latin-wght-normal.woff2', 'geist-latin-ext-wght-normal.woff2']) {
      expect(readFileSync(`public/fonts/${f}`).equals(readFileSync(`node_modules/@fontsource-variable/geist/files/${f}`)), f).toBe(true)
      expect(read('public/look.css')).toContain(`/fonts/${f}`)
    }
    expect(readdirSync('public/fonts').sort()).toEqual(['geist-latin-ext-wght-normal.woff2', 'geist-latin-wght-normal.woff2'])
  })

  it('the app and the pages read the same tokens: look.css is the only place the colours are defined', () => {
    expect(read('src/index.css')).not.toMatch(/--desk-base|--glass-bg:/)
    expect(read('index.html')).toContain('<link rel="stylesheet" href="/look.css" />')
  })

  it('the Support page: the shared look, nothing inline, and only plain links to the two support pages, with nothing added to them', () => {
    const html = read('public/support.html')
    expect(html).toContain('<link rel="stylesheet" href="/look.css" />')
    expect(html).not.toMatch(/<style|style=|<script(?![^>]*src="\/theme\.js")/i)
    const outside = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1])
    expect([...new Set(outside)].sort()).toEqual(['https://buymeacoffee.com/knightshiftlabs', 'https://github.com/knightshiftlabs/cornerfold', 'https://ko-fi.com/knightshiftlabs'])
    // Each outside link opens without telling the other site where it came from.
    for (const m of html.matchAll(/<a href="https?:[^"]+"([^>]*)>/g)) expect(m[1]).toContain('rel="noopener noreferrer"')
    expect(html).toContain('Every feature works without payment, a trial, an account, usage limits or watermarks.')
    expect(html).toContain('A support payment is a voluntary gift. It does not buy anything')
  })

  it('every page, and the home screen, links to Support in its footer', () => {
    for (const n of [...pages, 'support']) expect(read(`public/${n}.html`).match(/<footer>[\s\S]*<\/footer>/)?.[0], n).toContain('<a href="/support.html">Support</a>')
    expect(read('scripts/changelog.mjs')).toContain('<a href="/support.html">Support</a>')
    expect(read('src/components/EmptyState.tsx')).toContain('href="/support.html"')
  })

  it('the terms state the price: free today, support payments are gifts, and the code is AGPL', () => {
    const terms = read('public/terms.html')
    expect(terms).toContain('<h2>Price</h2>')
    expect(terms).toContain('is currently provided free of charge')
    expect(terms).toContain('They create no contract for goods or services')
  })
})
