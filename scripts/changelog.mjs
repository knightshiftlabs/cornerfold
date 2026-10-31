// Builds public/changes.html from CHANGELOG.md so the public release history
// and the changelog in the repo are always the same text.
import { readFileSync, writeFileSync } from 'node:fs'

const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" rel="noreferrer">$1</a>')

const out = []
let inRelease = false
let skipping = false
let listOpen = false
const closeList = () => listOpen && (out.push('</ul>'), (listOpen = false))

for (const raw of md.split(/\r?\n/)) {
  const line = raw.trimEnd()
  const release = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/)
  if (release) {
    closeList()
    if (inRelease) out.push('</section>')
    skipping = release[1].toLowerCase() === 'unreleased'
    inRelease = !skipping
    if (inRelease) {
      const date = release[2]
        ? new Date(release[2] + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        : ''
      out.push(`<section id="v${esc(release[1])}"><h2>Version ${esc(release[1])}</h2>${date ? `<p class="date">${date}</p>` : ''}`)
    }
    continue
  }
  if (!inRelease || skipping) continue
  if (/^\[[^\]]+\]:/.test(line)) continue // link reference definitions
  const heading = line.match(/^### (.+)/)
  if (heading) {
    closeList()
    out.push(`<h3>${inline(heading[1])}</h3>`)
  } else if (/^\s*[-*] /.test(line)) {
    if (!listOpen) out.push('<ul>'), (listOpen = true)
    out.push(`<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`)
  } else if (line.trim()) {
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
}
closeList()
if (inRelease) out.push('</section>')

const html = `<!doctype html>
<!-- Generated from CHANGELOG.md by scripts/changelog.mjs. Edit the changelog, not this file. -->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>What’s new: Cornerfold</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/pages.css" />
</head>
<body>
<main>
  <p><a href="/">Back to Cornerfold</a></p>
  <h1>What’s new</h1>
  <p class="muted">You’re on version ${esc(version)}. Every release is listed here, newest first.</p>
  ${out.join('\n  ')}
  <footer>
    <a href="/">Cornerfold</a>
    <a href="/about.html">About</a>
    <a href="/changes.html">What’s new</a>
    <a href="/privacy.html">Privacy</a>
    <a href="/terms.html">Terms</a>
    <a href="/licenses.txt">Open-source licenses</a>
  </footer>
</main>
</body>
</html>
`
writeFileSync(new URL('../public/changes.html', import.meta.url), html)
console.log(`changes.html generated (v${version})`)
