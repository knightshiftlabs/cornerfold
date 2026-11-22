import { describe, expect, it } from 'vitest'
import { foreignResources } from '../scripts/foreign.mjs'

const site = 'https://cornerfold.org'
const find = (html: string) => foreignResources(html, site)

describe('what a page loads from another site', () => {
  it('finds nothing on a page that loads only its own files', () => {
    expect(find('<link rel="stylesheet" href="/pages.css"><script src="/assets/a.js"></script><img src="https://cornerfold.org/og.png"><a href="https://github.com/x">source</a>')).toEqual([])
  })

  it('does not count a canonical or alternate link, which only points', () => {
    expect(find('<link rel="canonical" href="https://other.example/page"><link rel="alternate" hreflang="fr" href="https://fr.example/">')).toEqual([])
  })

  it('still finds a foreign script on a page that has a canonical link (the exemption is for that one tag)', () => {
    expect(find('<link rel="canonical" href="https://cornerfold.org/"><script src="https://evil.example/a.js"></script>')).toEqual(['<script> from evil.example'])
  })

  it('finds a foreign stylesheet or icon even when it says "alternate" among other things', () => {
    expect(find('<link rel="alternate stylesheet" href="https://evil.example/s.css">')).toEqual(['<link> from evil.example'])
    expect(find('<link rel="icon" href="https://evil.example/i.png">')).toEqual(['<link> from evil.example'])
  })

  it('finds addresses without a scheme, in single quotes, unquoted, or in any letter case', () => {
    expect(find('<script src="//cdn.example/a.js"></script>')).toEqual(['<script> from cdn.example'])
    expect(find("<script src='https://a.example/x.js'></script>")).toEqual(['<script> from a.example'])
    expect(find('<script src=https://b.example/x.js></script>')).toEqual(['<script> from b.example'])
    expect(find('<SCRIPT SRC="https://c.example/x.js"></SCRIPT>')).toEqual(['<script> from c.example'])
  })

  it('finds a foreign address behind other attributes, a line break, or a data attribute that merely contains "src"', () => {
    expect(find('<script\n  async\n  defer\n  src="https://d.example/x.js"></script>')).toEqual(['<script> from d.example'])
    expect(find('<img data-src="https://ok.example/x.png" src="https://e.example/x.png">')).toEqual(['<img> from e.example'])
  })

  it('finds foreign images in a srcset, a video poster and a frame', () => {
    expect(find('<img src="/a.png" srcset="/a.png 1x, https://f.example/a@2x.png 2x">')).toEqual(['<img> from f.example'])
    expect(find('<video poster="https://g.example/p.jpg"></video>')).toEqual(['<video> from g.example'])
    expect(find('<iframe src="https://h.example/"></iframe>')).toEqual(['<iframe> from h.example'])
  })

  it('finds a foreign address inside CSS', () => {
    expect(find('<style>body{background:url(https://i.example/b.png)}</style>')).toEqual(['<style> from i.example'])
    expect(find('<div style="background:url(\'//j.example/b.png\')"></div>')).toEqual(['<style> from j.example'])
    expect(find('<style>@import "https://k.example/x.css";</style>')).toEqual(['<style> from k.example'])
    expect(find('<style>body{background:url(/own.png)}</style>')).toEqual([])
  })

  it('ignores data and blob addresses, which load nothing from a site', () => {
    expect(find('<img src="data:image/png;base64,AAAA"><img src="blob:https://cornerfold.org/1234">')).toEqual([])
  })
})
