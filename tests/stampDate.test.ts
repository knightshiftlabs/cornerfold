import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertClockSane, istDate, longDate, policyText, previousReleaseDate, stampChangelog, stampPolicy } from '../scripts/stamp-date.mjs'

describe('release dates', () => {
  it('uses the date in India, which runs ahead of UTC by 5½ hours', () => {
    expect(istDate(new Date('2026-11-05T21:08:00Z'))).toBe('2026-11-06') // the exact case that put a wrong date on 1.1.9 and 1.1.10
    expect(istDate(new Date('2026-11-05T18:29:00Z'))).toBe('2026-11-05')
    expect(istDate(new Date('2026-11-05T18:30:00Z'))).toBe('2026-11-06') // midnight in India
    expect(istDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01') // across a year
  })

  it('writes dates the way the privacy policy shows them', () => {
    expect(longDate('2026-11-06')).toBe('6 November 2026')
    expect(longDate('2027-01-01')).toBe('1 January 2027')
  })
})

describe('the release command', () => {
  it('runs the date script after the version bump, so a release can’t skip it', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
    expect(scripts.version).toBe('node scripts/stamp-date.mjs')
    expect(scripts.preversion).toContain('npm test') // and the tests still come first
  })
})

describe('stamping the changelog', () => {
  const md = '# Changelog\n\n## [Unreleased]\n\n## [1.1.11] - TBD\n\n### Fixed\n- x\n\n## [1.1.10] - 2026-11-06\n- y\n'

  it('replaces the TBD with the date, and touches nothing else', () => {
    expect(stampChangelog(md, '1.1.11', '2026-11-07')).toBe(md.replace('[1.1.11] - TBD', '[1.1.11] - 2026-11-07'))
  })

  it('also corrects a wrong date that was typed by hand, or a heading with no date', () => {
    expect(stampChangelog(md.replace('TBD', '2026-11-05'), '1.1.11', '2026-11-07')).toContain('## [1.1.11] - 2026-11-07')
    expect(stampChangelog(md.replace(' - TBD', ''), '1.1.11', '2026-11-07')).toContain('## [1.1.11] - 2026-11-07')
  })

  it('stops if the version has no entry, so a release can’t go out without release notes', () => {
    expect(() => stampChangelog(md, '1.1.12', '2026-11-07')).toThrow(/no "## \[1\.1\.12\]/)
  })

  it('finds the previous release’s date, skipping the Unreleased section', () => {
    expect(previousReleaseDate(md, '1.1.11')).toBe('2026-11-06')
  })

  it('stops if the clock is earlier than the previous release, and allows the same day', () => {
    expect(() => assertClockSane(md, '1.1.11', '2026-11-05')).toThrow(/clock looks wrong/)
    expect(() => assertClockSane(md, '1.1.11', '2026-11-06')).not.toThrow()
    expect(() => assertClockSane(md, '1.1.11', '2026-12-01')).not.toThrow()
  })
})

describe('stamping a policy page', () => {
  const page = '<h1>Privacy</h1>\n  <p class="muted">Last updated: 5 November 2026</p>\n<p>Text.</p>\n'

  it('sets the “Last updated” date', () => {
    expect(stampPolicy(page, '2026-11-07')).toContain('Last updated: 7 November 2026</p>')
  })

  it('refuses a page with no such line, instead of silently skipping it', () => {
    expect(() => stampPolicy('<p>Hello</p>', '2026-11-07')).toThrow(/Last updated/)
  })

  it('compares text while ignoring the date line and line endings', () => {
    expect(policyText(page)).toBe(policyText(page.replace('5 November', '1 January')))
    expect(policyText(page)).toBe(policyText(page.replace(/\n/g, '\r\n')))
    expect(policyText(page)).not.toBe(policyText(page.replace('Text.', 'More text.')))
  })
})

describe('the release script, run for real in a scratch repository', () => {
  const script = resolve('scripts/stamp-date.mjs')
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'stamp-'))
    dirs.push(dir)
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
    const write = (f: string, s: string) => writeFileSync(join(dir, f), s)
    mkdirSync(join(dir, 'public'))
    write('package.json', '{"name":"x","version":"1.1.10"}')
    write('CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n## [1.1.10] - 2026-11-06\n- y\n')
    write('public/privacy.html', '<p class="muted">Last updated: 2 November 2026</p>\n<p>Privacy text.</p>\n')
    write('public/terms.html', '<p class="muted">Last updated: 31 October 2026</p>\n<p>Terms text.</p>\n')
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    git('add', '-A'); git('commit', '-qm', 'Release 1.1.10'); git('tag', 'v1.1.10')
    // the next release: new entry, new version, and the privacy text (not the terms) changed
    write('package.json', '{"name":"x","version":"1.1.11"}')
    write('CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n## [1.1.11] - TBD\n- z\n\n## [1.1.10] - 2026-11-06\n- y\n')
    write('public/privacy.html', '<p class="muted">Last updated: 2 November 2026</p>\n<p>Privacy text, now with one more sentence.</p>\n')
    const run = (env: Record<string, string> = {}) => execFileSync('node', [script], { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const read = (f: string) => readFileSync(join(dir, f), 'utf8')
    const staged = () => execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').sort()
    return { run, read, staged }
  }

  it('dates the release, dates only the page whose text changed, and stages exactly those files', () => {
    const r = repo()
    r.run({ RELEASE_DATE: '2026-11-07' })
    expect(r.read('CHANGELOG.md')).toContain('## [1.1.11] - 2026-11-07')
    expect(r.read('public/privacy.html')).toContain('Last updated: 7 November 2026') // text changed: stamped
    expect(r.read('public/terms.html')).toContain('Last updated: 31 October 2026') // unchanged: left alone
    expect(r.staged()).toEqual(['CHANGELOG.md', 'public/privacy.html'])
  })

  it('stops, and changes nothing, when the clock is earlier than the last release', () => {
    const r = repo()
    expect(() => r.run({ RELEASE_DATE: '2026-11-05' })).toThrow(/clock looks wrong/)
    expect(r.read('CHANGELOG.md')).toContain('## [1.1.11] - TBD')
  })

  it('stops on a date that isn’t a date', () => {
    expect(() => repo().run({ RELEASE_DATE: '7 Nov' })).toThrow(/YYYY-MM-DD/)
  })

  it('uses India’s date from the real clock when nothing overrides it', () => {
    const r = repo()
    r.run()
    expect(r.read('CHANGELOG.md')).toContain(`## [1.1.11] - ${istDate()}`)
  })
})
