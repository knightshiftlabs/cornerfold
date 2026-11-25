// Serves the production build the way Cloudflare Pages does, for the browser tests: the files in dist/, with
// the response headers from public/_headers. Every browser test therefore runs under the real security policy,
// so a change that the policy would block on the live site fails here first.
//
// Run on its own with `node tests/e2e/server.mjs` (port 4173, or PORT). Tests that need to change what is
// served while a page is open (a new deploy, say) start their own copy with startServer().
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', // Cloudflare Pages serves it so; browsers refuse to compile it from a stream otherwise
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

/** Reads Cloudflare's _headers format: a path pattern, then indented "Name: value" lines. */
export function parseHeaders(text) {
  const rules = []
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] })
    else if (line.trim().startsWith('!')) rules.at(-1)?.headers.push([line.trim(), ''])
    else {
      const at = line.indexOf(':')
      rules.at(-1)?.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
    }
  }
  return rules
}

/** Files Cloudflare Pages reads to set up the site and never serves: asking for them gives 404. */
export const NOT_SERVED = new Set(['/_headers', '/_redirects', '/_routes.json'])

const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern)

/**
 * The headers for a request, as Cloudflare Pages works them out: every rule whose pattern matches the path
 * as requested (so "/" rather than "/index.html") applies, and a header set by more than one rule gets all
 * their values, joined with commas. "! Name" removes a header set by an earlier rule.
 */
/** Header names that a "! Name" line removes for this path: the host must not send them either. */
export function removedFor(rules, path) {
  return rules.filter((r) => matches(r.pattern, path)).flatMap((r) => r.headers.filter(([n]) => n.startsWith('!')).map(([n]) => n.slice(1).trim().toLowerCase()))
}

export function headersFor(rules, path) {
  const headers = {}
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue
    for (const [name, value] of rule.headers) {
      if (name.startsWith('!')) delete headers[name.slice(1).trim().toLowerCase()]
      else headers[name.toLowerCase()] = headers[name.toLowerCase()] ? `${headers[name.toLowerCase()]}, ${value}` : value
    }
  }
  return headers
}

/**
 * Starts a server for a built copy of the site. `hidden` holds paths that answer 404 as if they had been
 * removed, which is what happens to old hashed files when a new version is deployed.
 */
export function startServer({ root = 'dist', port = 0, headersFile = 'public/_headers', hidden = new Set() } = {}) {
  const base = resolve(root)
  const rules = parseHeaders(readFileSync(headersFile, 'utf8'))
  const server = createServer(async (req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://local').pathname)
    const headers = headersFor(rules, requested)
    const path = requested.endsWith('/') ? `${requested}index.html` : requested
    // Cloudflare Pages serves /privacy from privacy.html ("pretty URLs").
    const candidates = extname(path) ? [path] : [path, `${path}.html`]
    for (const candidate of candidates) {
      const file = join(base, candidate)
      if (!file.startsWith(base + sep) || hidden.has(candidate) || NOT_SERVED.has(candidate)) continue
      try {
        const body = await readFile(file)
        res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
        return res.end(body)
      } catch {
        // try the next candidate
      }
    }
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  })
  return new Promise((done) =>
    server.listen(port, '127.0.0.1', () => done({ url: `http://127.0.0.1:${server.address().port}`, hidden, close: () => new Promise((r) => server.close(r)) })),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.env.PORT ?? 4173) })
  console.log(`Serving dist/ with the site's real headers at ${url}`)
}
