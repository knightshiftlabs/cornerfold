// What a GitHub Release carries, made from the build in dist/ and CHANGELOG.md:
//   node scripts/release-assets.mjs 1.8.0 out/
// writes out/notes.md (that version's changelog entry), out/SHA256SUMS.txt (a checksum for every built file, in the
// format `sha256sum -c` reads, run from inside dist/), and out/ is where the workflow also puts cornerfold-1.8.0.tar.gz.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The text under `## [version]` in the changelog, up to the next version heading. */
export function notesFor(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}`)
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
  if (end < 0) end = lines.length
  return lines.slice(start + 1, end).join('\n').trim() + '\n'
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))

/** `<sha256>  <path>` for every file under dir, sorted by path, paths relative to dir with forward slashes. */
export function checksums(dir) {
  return (
    walk(dir)
      .map((f) => [relative(dir, f).split('\\').join('/'), createHash('sha256').update(readFileSync(f)).digest('hex')])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([p, h]) => `${h}  ${p}`)
      .join('\n') + '\n'
  )
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [version, out = 'release'] = process.argv.slice(2)
  if (!version) throw new Error('usage: node scripts/release-assets.mjs <version> [outDir]')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'notes.md'), notesFor(readFileSync('CHANGELOG.md', 'utf8'), version))
  writeFileSync(join(out, 'SHA256SUMS.txt'), checksums('dist'))
  console.log(`wrote ${out}/notes.md and ${out}/SHA256SUMS.txt`)
}
