// Rules about the code itself, checked by reading it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
