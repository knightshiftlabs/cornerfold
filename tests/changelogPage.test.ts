// The public What's new page, built from CHANGELOG.md: only released, dated versions are shown.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript script
import { releasesHtml } from '../scripts/changelog.mjs'

const md = `# Changelog

## [Unreleased]
- Not yet.

## [2.1.0] - TBD

Half-way through a release.

### Added
- Something unfinished.

## [2.0.0] - 2026-11-26

A summary line.

### Added
- A \`thing\` that shipped.

## [1.9.0] - 2026-10-01

### Fixed
- An older fix.
`

describe('the What’s new page', () => {
  const html = releasesHtml(md)

  it('shows each dated release, newest first, with its date, summary and lists', () => {
    expect([...html.matchAll(/<h2>Version ([^<]+)<\/h2>/g)].map((m) => m[1])).toEqual(['2.0.0', '1.9.0'])
    expect(html).toContain('<p class="date">26 November 2026</p>')
    expect(html).toContain('<p>A summary line.</p>')
    expect(html).toContain('<li>A <code>thing</code> that shipped.</li>')
  })

  it('leaves out Unreleased and a version still marked TBD, so a release that stopped half-way never shows undated', () => {
    expect(html).not.toContain('2.1.0')
    expect(html).not.toContain('Something unfinished')
    expect(html).not.toContain('Not yet')
  })

  it('closes every section and list it opens', () => {
    expect(html.match(/<section/g)?.length).toBe(html.match(/<\/section>/g)?.length)
    expect(html.match(/<ul>/g)?.length).toBe(html.match(/<\/ul>/g)?.length)
  })
})
