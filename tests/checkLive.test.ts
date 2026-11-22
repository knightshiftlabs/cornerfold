// The live-site check, run for real against a stand-in site that behaves like Cloudflare Pages did: a file that is
// not there yet is answered with the app's own page (status 200), and that answer is then remembered for good.
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const NEW = { '/': '<!doctype html><title>new</title><script type="module" src="/assets/app-NEW.js"></script>', '/sw.js': 'sw new', '/assets/app-NEW.js': 'console.log("new")', '/privacy': '<!doctype html><p>privacy</p>' }
const OLD = { '/': '<!doctype html><title>old</title><script type="module" src="/assets/app-OLD.js"></script>', '/sw.js': 'sw old', '/assets/app-OLD.js': 'console.log("old")', '/privacy': '<!doctype html><p>privacy</p>' }

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'live-'))
  mkdirSync(join(dir, 'dist', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.html'), NEW['/'])
  writeFileSync(join(dir, 'dist', 'sw.js'), NEW['/sw.js'])
  writeFileSync(join(dir, 'dist', 'privacy.html'), NEW['/privacy'])
  writeFileSync(join(dir, 'dist', 'assets', 'app-NEW.js'), NEW['/assets/app-NEW.js'])
  writeFileSync(join(dir, 'headers'), '/*\n  X-Test: 1\n')
  return dir
}

let server: Server | undefined
afterEach(() => void server?.close())

/** A site that serves `site()`'s files, answers unknown paths with its home page, and remembers every such answer. */
function startSite(site: () => Record<string, string>) {
  const requested: string[] = []
  const remembered = new Map<string, string>()
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://x').pathname
    requested.push(path)
    const files = site()
    let body = remembered.get(path) ?? files[path]
    let type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.html') || path === '/' || path === '/privacy' ? 'text/html' : 'text/plain'
    if (body === undefined) {
      body = files['/'] // an unknown file: the app's own page, as Pages does without a 404 page
      type = 'text/html'
      if (path.startsWith('/assets/')) remembered.set(path, body) // cached for a year
    }
    res.writeHead(200, { 'content-type': type, 'x-test': '1' })
    res.end(body)
  })
  return new Promise<{ port: number; requested: string[] }>((resolve) => server!.listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as { port: number }).port, requested })))
}

function runCheck(port: number, dir: string, extra: string[] = []) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, ['scripts/check-live.mjs', `http://127.0.0.1:${port}`, '--dist', join(dir, 'dist'), '--headers', join(dir, 'headers'), '--every', '1', ...extra], { cwd: process.cwd() })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

describe('checking the live site while a deploy lands', () => {
  it('passes when the site is this build', async () => {
    const dir = makeDist()
    const { port } = await startSite(() => NEW)
    const { code, out } = await runCheck(port, dir)
    expect(out).toContain('PASS  all ')
    expect(code).toBe(0)
  })

  it('does not ask for a single file in /assets/ while the site is still the old build', async () => {
    const dir = makeDist()
    const { port, requested } = await startSite(() => OLD)
    const { code, out } = await runCheck(port, dir, ['--wait', '3'])
    expect(code).toBe(1)
    expect(out).toContain('FAIL  the live site is this build')
    expect(requested.filter((p) => p.startsWith('/assets/'))).toEqual([])
  })

  it('waits for the deploy, then passes, because nothing was asked for early to be remembered wrongly', async () => {
    const dir = makeDist()
    const flipAt = Date.now() + 2500
    const { port, requested } = await startSite(() => (Date.now() < flipAt ? OLD : NEW))
    const { code, out } = await runCheck(port, dir, ['--wait', '20'])
    expect(out).toContain('checking again')
    expect(code).toBe(0)
    expect(requested.filter((p) => p.startsWith('/assets/'))).not.toContain('/assets/app-OLD.js')
  })

  it('still fails, and says what is wrong, when a file really differs after the site is this build', async () => {
    const dir = makeDist()
    const { port } = await startSite(() => ({ ...NEW, '/assets/app-NEW.js': 'console.log("tampered")' }))
    const { code, out } = await runCheck(port, dir)
    expect(code).toBe(1)
    expect(out).toMatch(/FAIL {2}all \d+ files are served exactly as built.*app-NEW\.js \(different contents: .*first difference at byte 13/)
  })

  it('names a file that is answered with the app’s page', async () => {
    const dir = makeDist()
    const { port } = await startSite(() => {
      const { '/assets/app-NEW.js': _gone, ...rest } = NEW
      return rest
    })
    const { code, out } = await runCheck(port, dir)
    expect(code).toBe(1)
    expect(out).toContain('the app’s page instead of this file')
  })
})
