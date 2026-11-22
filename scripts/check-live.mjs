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
import { foreignResources } from './foreign.mjs'

const args = process.argv.slice(2)
const site = (args.find((a) => /^https?:\/\//.test(a)) ?? 'https://cornerfold.org').replace(/\/$/, '')
const waitFor = Number(args[args.indexOf('--wait') + 1]) || 0
const dist = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'dist'
const headersFile = args.includes('--headers') ? args[args.indexOf('--headers') + 1] : 'public/_headers'
const every = (Number(args[args.indexOf('--every') + 1]) || 30) * 1000

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
// The address each built file is served at: Cloudflare serves /privacy.html as /privacy.
const addressOf = (file) => '/' + relative(dist, file).split('\\').join('/').replace(/^index\.html$/, '').replace(/\.html$/, '')

async function get(path) {
  const res = await fetch(site + path, { redirect: 'manual', headers: { 'user-agent': 'cornerfold-live-check' } })
  return { status: res.status, headers: Object.fromEntries(res.headers), bytes: new Uint8Array(await res.arrayBuffer()) }
}

/** Why a served file is not the built one, in words, with the first place they part ways. */
function describeDifference(live, built) {
  if (live.status !== 200) return `status ${live.status}`
  const type = live.headers['content-type'] ?? ''
  const at = [...Array(Math.min(live.bytes.length, built.length)).keys()].find((i) => live.bytes[i] !== built[i]) ?? Math.min(live.bytes.length, built.length)
  const text = (b) => JSON.stringify(new TextDecoder().decode(b.slice(Math.max(0, at - 20), at + 40)))
  const page = type.includes('text/html') && !addressOf_isHtml(built) ? 'the app’s page instead of this file, ' : ''
  return `different contents: ${page}${live.bytes.length} bytes live, ${built.length} built, first difference at byte ${at}: live ${text(live.bytes)}, built ${text(built)}`
}
const addressOf_isHtml = (bytes) => new TextDecoder().decode(bytes.slice(0, 15)).toLowerCase().startsWith('<!doctype html')

/**
 * Whether the live site is this build yet, judged only from the home page and the service worker. Those are never
 * cached for long. Files in /assets/ must not be asked for before this is true: Cloudflare answers a file that is not
 * there yet with the app's own page (status 200) and, because /assets/ is cached for a year, remembers that answer,
 * so the file stays "different" for hours after the deploy lands, and visitors reaching that edge get a page where
 * their script should be.
 */
async function isDeployed() {
  const wrong = []
  for (const path of ['/', '/sw.js']) {
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1))
    const live = await get(path)
    if (live.status !== 200 || sha(live.bytes) !== sha(readFileSync(file))) wrong.push(path)
  }
  return wrong
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
    if (live.status !== 200 || sha(live.bytes) !== sha(readFileSync(file))) differ.push(`${addressOf(file) || '/'} (${describeDifference(live, readFileSync(file))})`)
  }
  ok(`all ${built.length} files are served exactly as built from this source`, differ.length === 0, differ.slice(0, 5).join(', '))

  // 2. Nothing loaded from another site, on any page.
  const foreign = []
  for (const file of built.filter((f) => f.endsWith('.html'))) {
    const html = new TextDecoder().decode((await get(addressOf(file))).bytes)
    for (const found of foreignResources(html, site)) foreign.push(`${addressOf(file) || '/'}: ${found}`)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const outOfTime = () => Date.now() - started > waitFor * 1000
let results
for (;;) {
  const notYet = await isDeployed()
  if (notYet.length) {
    results = [{ label: 'the live site is this build (home page and service worker match, checked before any other file)', pass: false, detail: `${notYet.join(' and ')} differ from the build: a deploy still in progress, or the site is not running this source` }]
    if (outOfTime()) break
    console.log(`The live site is not this build yet (${notYet.join(', ')}); checking again in ${every / 1000} seconds.`)
    await sleep(every)
    continue
  }
  results = await check()
  const deploying = results.some((r) => !r.pass && r.label.startsWith('all '))
  if (!deploying || outOfTime()) break
  console.log(`Files differ; checking again in ${every / 1000} seconds.`)
  await sleep(every)
}
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? ` | ${r.detail}` : ''}`)
// In GitHub Actions, failures also become annotations, which show on the run's page without opening the log.
if (process.env.GITHUB_ACTIONS) for (const r of results.filter((x) => !x.pass)) console.log(`::error title=Live site check::${r.label}${r.detail ? ` | ${r.detail}` : ''}`.replace(/\r?\n/g, ' '))
process.exit(results.every((r) => r.pass) ? 0 : 1)
