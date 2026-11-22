import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
// @ts-expect-error plain JavaScript script
import { checksums, notesFor } from '../scripts/release-assets.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.8.0] - 2026-11-24

### Added
- A thing.

## [1.7.0] - 2026-11-23

### Fixed
- Another thing.
`

describe('release assets', () => {
  it('takes one version’s notes from the changelog and nothing else', () => {
    expect(notesFor(CHANGELOG, '1.8.0')).toBe('### Added\n- A thing.\n')
    expect(notesFor(CHANGELOG, '1.7.0')).toBe('### Fixed\n- Another thing.\n')
  })
  it('refuses a version the changelog does not have', () => {
    expect(() => notesFor(CHANGELOG, '9.9.9')).toThrow(/no entry/)
  })
  it('lists every file with its SHA-256, sorted, in the format sha256sum reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sums-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'b.txt'), 'bee')
    writeFileSync(join(dir, 'a.txt'), 'ay')
    writeFileSync(join(dir, 'assets', 'c.js'), 'sea')
    const sha = (s: string) => createHash('sha256').update(s).digest('hex')
    expect(checksums(dir)).toBe(`${sha('ay')}  a.txt\n${sha('sea')}  assets/c.js\n${sha('bee')}  b.txt\n`)
  })
})
