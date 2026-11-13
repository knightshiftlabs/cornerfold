// Rules about the code itself, checked by reading it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: plain JavaScript, shared with the browser tests
import { NOT_SERVED, headersFor, parseHeaders, startServer } from './e2e/server.mjs'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('the app’s own code', () => {
  // Cornerfold never needs to fetch anything: files arrive from the person and leave as downloads. The site's
  // security policy blocks fetching anyway, so a fetch() is either a privacy problem or a feature that will
  // break on the live site. Both happened in spirit before: 1.3.0 read its own images back with fetch().
  it('never calls fetch(), XMLHttpRequest, sendBeacon or WebSocket', () => {
    const found = sourceFiles('src').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource/.test(line.replace(/\/\/.*$/, '')) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    )
    expect(found).toEqual([])
  })
})

describe('the site’s headers (public/_headers)', () => {
  const rules = parseHeaders(readFileSync('public/_headers', 'utf8'))
  const pages = ['index.html', ...readdirSync('public').filter((f) => f.endsWith('.html'))].map((f) => f.replace(/\.html$/, ''))
  // changes.html is made at build time from CHANGELOG.md, so it may not exist yet.
  if (!pages.includes('changes')) pages.push('changes')

  it('every page forbids rewriting in transit, at both of its addresses, so nobody can add scripts to it', () => {
    const paths = pages.flatMap((p) => (p === 'index' ? ['/', '/index.html'] : [`/${p}`, `/${p}.html`]))
    const missing = paths.filter((path) => !/\bno-transform\b/.test(headersFor(rules, path)['cache-control'] ?? ''))
    expect(missing).toEqual([])
  })

  it('pages are never cached for long, so a new version reaches everyone (regression: a misplaced rule went unnoticed)', () => {
    for (const path of ['/', '/index.html', '/privacy', '/changes.html']) {
      const cache = headersFor(rules, path)['cache-control'] ?? ''
      expect(cache, path).toMatch(/max-age=0\b/)
      expect(cache, path).not.toMatch(/immutable|max-age=[1-9]/)
    }
  })

  it('scripts and styles stay compressible: no-transform would switch compression off', () => {
    expect(headersFor(rules, '/assets/index-abc123.js')['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('every page gets the full security policy', () => {
    for (const path of ['/', '/privacy', '/assets/x.js']) {
      const h = headersFor(rules, path)
      expect(h['content-security-policy'], path).toContain("default-src 'none'")
      expect(h['content-security-policy'], path).toContain("connect-src 'self'")
      expect(h['referrer-policy'], path).toBe('no-referrer')
    }
  })
})

describe('how the test server reads _headers, which must match Cloudflare', () => {
  const rules = parseHeaders('/*\n  X-A: one\n/a/*\n  X-A: two\n  ! X-B\n/*\n  X-B: kept\n/a/b\n  ! X-A\n')
  it('joins a header set by several rules, matches the path as requested, and removes with "!"', () => {
    expect(headersFor(rules, '/a/c')).toEqual({ 'x-a': 'one, two', 'x-b': 'kept' })
    expect(headersFor(rules, '/a/b')).toEqual({ 'x-b': 'kept' })
    expect(headersFor(rules, '/')).toEqual({ 'x-a': 'one', 'x-b': 'kept' })
  })
})

describe('the test server serves the build as Cloudflare does', () => {
  // The 1.3.2 live check compared _headers, which Cloudflare reads but never serves, so it failed for the wrong
  // reason. The test server now refuses those files too, and the live check skips them.
  it('Cloudflare’s own setup files are never served', async () => {
    const server = await startServer({ root: 'public', port: 0 })
    try {
      for (const path of NOT_SERVED) expect((await fetch(server.url + path)).status, path).toBe(404)
      expect((await fetch(server.url + '/privacy')).status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
