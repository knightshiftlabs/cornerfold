// Checks that the live site is exactly what this repository builds, and nothing more:
//   1. every built file is served byte for byte (so the site runs this source code, unmodified);
//   2. no page loads anything from another site (such as an analytics script added by the host);
//   3. the response headers are the ones in public/_headers;
//   4. no headers ask browsers to send reports elsewhere (such as network error logging).
// Build first, from the same commit: `npm run build && node scripts/check-live.mjs [https://cornerfold.org]`.
// With --wait, keeps retrying for up to that many seconds while a deploy finishes.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { NOT_SERVED, headersFor, parseHeaders, removedFor } from '../tests/e2e/server.mjs'

const args = process.argv.slice(2)
const site = (args.find((a) => /^https?:\/\//.test(a)) ?? 'https://cornerfold.org').replace(/\/$/, '')
const waitFor = Number(args[args.indexOf('--wait') + 1]) || 0
const dist = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'dist'
const headersFile = args.includes('--headers') ? args[args.indexOf('--headers') + 1] : 'public/_headers'

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
// The address each built file is served at: Cloudflare serves /privacy.html as /privacy.
const addressOf = (file) => '/' + relative(dist, file).split('\\').join('/').replace(/^index\.html$/, '').replace(/\.html$/, '')

async function get(path) {
  const res = await fetch(site + path, { redirect: 'manual', headers: { 'user-agent': 'cornerfold-live-check' } })
  return { status: res.status, headers: Object.fromEntries(res.headers), bytes: new Uint8Array(await res.arrayBuffer()) }
}

async function check() {
  const results = []
  const ok = (label, pass, detail = '') => results.push({ label, pass, detail })
  // Cloudflare's own setup files are in the build but are never served, so they are not compared.
  const built = files(dist).filter((f) => !NOT_SERVED.has(addressOf(f)))

  // 1. Every file, byte for byte.
  const differ = []
  for (const file of built) {
    const live = await get(addressOf(file))
    if (live.status !== 200 || sha(live.bytes) !== sha(readFileSync(file))) differ.push(`${addressOf(file) || '/'} (${live.status === 200 ? 'different contents' : `status ${live.status}`})`)
  }
  ok(`all ${built.length} files are served exactly as built from this source`, differ.length === 0, differ.slice(0, 5).join(', '))

  // 2. Nothing loaded from another site, on any page.
  const foreign = []
  for (const file of built.filter((f) => f.endsWith('.html'))) {
    const html = new TextDecoder().decode((await get(addressOf(file))).bytes)
    for (const [, tag, url] of html.matchAll(/<(script|link|img|iframe|source|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:\/\//i.test(url) && new URL(url).origin !== new URL(site).origin && !(tag === 'link' && /rel=["'](canonical|alternate)["']/.test(html))) foreign.push(`${addressOf(file) || '/'}: <${tag}> from ${new URL(url).host}`)
    }
  }
  ok('no page loads anything from another site', foreign.length === 0, foreign.slice(0, 5).join('; '))

  // 3. The headers we set, exactly. 4. None that send reports elsewhere.
  const rules = parseHeaders(readFileSync(headersFile, 'utf8'))
  const asset = built.find((f) => /assets\/.*\.js$/.test(f))
  for (const path of ['/', '/privacy', asset && addressOf(asset)].filter(Boolean)) {
    const live = (await get(path)).headers
    const wrong = Object.entries(headersFor(rules, path)).filter(([name, value]) => live[name] !== value).map(([name]) => `${name}: expected "${headersFor(rules, path)[name]}", got "${live[name] ?? 'nothing'}"`)
    for (const name of removedFor(rules, path)) if (name in live) wrong.push(`${name} should not be sent, got "${live[name]}"`)
    ok(`headers on ${path} are the ones in public/_headers`, wrong.length === 0, wrong.join('; '))
    const reporting = ['nel', 'report-to', 'reporting-endpoints'].filter((h) => h in live)
    ok(`${path} asks the browser to report nothing elsewhere`, reporting.length === 0, reporting.map((h) => `${h}: ${live[h].slice(0, 70)}`).join('; '))
  }

  // HTTPS only.
  if (site.startsWith('https://')) {
    const plain = await fetch(site.replace('https://', 'http://') + '/', { redirect: 'manual' })
    ok('plain http redirects to https', [301, 308].includes(plain.status) && (plain.headers.get('location') ?? '').startsWith('https://'), `status ${plain.status}`)
  }
  return results
}

const started = Date.now()
let results
for (;;) {
  results = await check()
  const deploying = results.some((r) => !r.pass && r.label.startsWith('all '))
  if (!deploying || Date.now() - started > waitFor * 1000) break
  console.log('Files differ, perhaps a deploy in progress; checking again in 30 seconds.')
  await new Promise((r) => setTimeout(r, 30_000))
}
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? ` | ${r.detail}` : ''}`)
process.exit(results.every((r) => r.pass) ? 0 : 1)
