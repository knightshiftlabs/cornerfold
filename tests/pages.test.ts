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
    const bars = [...pages.map((n) => header(read(`public/${n}.html`))), header(generated)].map((h) => h.replace(/ aria-current="page"/, ''))
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
})
