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
<style>
  :root { --desk:#dce2ea; --text:#1d2532; --muted:#4f5b6c; --ink:#2433d6; --line:rgb(29 37 50 / .14); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --desk:#161d27; --text:#e6ebf2; --muted:#97a3b4; --ink:#8f9bff; --line:rgb(230 235 242 / .14); } }
  body { margin:0; background:var(--desk); color:var(--text); font: 17px/1.65 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 64ch; margin: 0 auto; padding: 56px 24px 96px; }
  h1 { font-size: 2.4rem; line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 8px; }
  section { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 8px; }
  h2 { font-size: 1.35rem; margin: 1em 0 0; }
  .date, .muted { color: var(--muted); margin-top: 2px; }
  h3 { font-size: 1rem; margin: 1.6em 0 0.3em; }
  ul { padding-left: 1.2em; margin: 0; } li { margin: 0.25em 0; }
  a { color: var(--ink); } code { font-size: .9em; }
</style>
</head>
<body>
<main>
  <p><a href="/">Back to Cornerfold</a></p>
  <h1>What’s new</h1>
  <p class="muted">You’re on version ${esc(version)}. Every release is listed here, newest first.</p>
  ${out.join('\n  ')}
</main>
</body>
</html>
`
writeFileSync(new URL('../public/changes.html', import.meta.url), html)
console.log(`changes.html generated (v${version})`)
