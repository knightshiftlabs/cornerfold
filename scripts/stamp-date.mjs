// Run by `npm version`, after the version number is bumped and before the release commit is made.
// It writes today's date, in India time, into:
//   - the CHANGELOG.md entry for the new version (written as "## [X.Y.Z] - TBD" until now), and
//   - the "Last updated" line of the privacy policy and the terms, but only if that page's text has
//     changed since the last release.
// So a release date can never be typed wrong, and a policy page never claims to be newer than it is.
// RELEASE_DATE=YYYY-MM-DD overrides the clock, for the rare release made at a different date.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const UPDATED = /Last updated: [^<\r\n]*/

/** Today's date in India (UTC+5:30), as YYYY-MM-DD. */
export const istDate = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)

/** 2026-11-06 becomes "6 November 2026". */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Sets the date on the changelog entry for this version, whatever it said before (usually TBD). */
export function stampChangelog(md, version, date) {
  const heading = new RegExp(`^(## \\[${escapeRegExp(version)}\\])(?:[ \\t]*-[ \\t]*[^\\r\\n]*)?[ \\t]*$`, 'm')
  if (!heading.test(md)) throw new Error(`CHANGELOG.md has no "## [${version}] - TBD" entry. Add one before releasing.`)
  return md.replace(heading, `$1 - ${date}`)
}

/** The date of the release just below this version's entry, if it has one. */
export function previousReleaseDate(md, version) {
  let seen = false
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/)
    if (!m) continue
    if (m[1] === version) seen = true
    else if (seen && m[1].toLowerCase() !== 'unreleased' && m[2]) return m[2]
  }
  return null
}

/** A release dated before the previous one means the clock is wrong. Stop rather than publish that. */
export function assertClockSane(md, version, date) {
  const previous = previousReleaseDate(md, version)
  if (previous && date < previous) {
    throw new Error(`The date (${date}) is earlier than the previous release (${previous}), so the clock looks wrong. Fix it, or set RELEASE_DATE=YYYY-MM-DD.`)
  }
}

export function stampPolicy(html, date) {
  if (!UPDATED.test(html)) throw new Error('No "Last updated:" line found in a policy page.')
  return html.replace(UPDATED, `Last updated: ${longDate(date)}`)
}

/** A page's text with its date line and line-ending differences ignored, to see whether it really changed. */
export const policyText = (html) => html.replace(UPDATED, '').replace(/\r\n/g, '\n')

// Output is returned exactly as git printed it: a file's own trailing newline matters when comparing copies.
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function main() {
  const root = process.cwd()
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const date = process.env.RELEASE_DATE || istDate()
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new Error(`"${date}" is not a date in the form YYYY-MM-DD.`)

  const changelog = join(root, 'CHANGELOG.md')
  const md = readFileSync(changelog, 'utf8')
  assertClockSane(md, version, date)
  writeFileSync(changelog, stampChangelog(md, version, date))
  const stage = ['CHANGELOG.md']
  console.log(`CHANGELOG.md: version ${version} dated ${date}`)

  let lastTag = null
  try { lastTag = git(['describe', '--tags', '--abbrev=0']).trim() } catch { /* no earlier release */ }
  for (const rel of ['public/privacy.html', 'public/terms.html']) {
    const file = join(root, rel)
    if (!existsSync(file)) continue
    const now = readFileSync(file, 'utf8')
    let before = null
    if (lastTag) try { before = git(['show', `${lastTag}:${rel}`]) } catch { /* page is new */ }
    if (before !== null && policyText(before) === policyText(now)) {
      console.log(`${rel}: unchanged since ${lastTag}, date left as it was`)
      continue
    }
    writeFileSync(file, stampPolicy(now, date))
    stage.push(rel)
    console.log(`${rel}: text changed since ${lastTag ?? 'the start'}, "Last updated" set to ${longDate(date)}`)
  }
  git(['add', ...stage])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (e) {
    console.error(`Release stopped: ${e.message}`)
    process.exit(1)
  }
}
