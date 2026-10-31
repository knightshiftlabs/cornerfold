// Builds public/licenses.txt: the license of every third-party package that
// ships to users (runtime dependencies and everything they depend on).
// Their licenses require these notices to travel with the code.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const app = readJson(join(root, 'package.json'))

/** Node-style resolution: look in ./node_modules, then each parent's. */
function resolve(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const found = new Map()
function walk(name, fromDir) {
  const dir = resolve(name, fromDir)
  if (!dir) return
  const pkg = readJson(join(dir, 'package.json'))
  const key = `${pkg.name}@${pkg.version}`
  if (found.has(key)) return
  found.set(key, { pkg, dir })
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, dir)
}
for (const dep of Object.keys(app.dependencies ?? {})) walk(dep, root)

function licenseId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  const legacy = (pkg.licenses ?? []).map((l) => l.type).join(' OR ')
  return legacy || 'UNKNOWN'
}
const homepage = (pkg) => {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  return pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, '') ?? ''
}

const rule = '='.repeat(72)
const parts = [
  `Cornerfold ${app.version}: third-party software notices`,
  '',
  'Cornerfold includes the open-source software listed below. Each package is',
  'used under its own license, reproduced in full after its name.',
  `Packages: ${found.size}. Generated at build time from the installed packages.`,
]
const unknown = []
for (const [key, { pkg, dir }] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
  const id = licenseId(pkg)
  if (id === 'UNKNOWN' && !files.length) unknown.push(key)
  parts.push('', rule, `${key}`, `License: ${id}`, homepage(pkg) && `Source: ${homepage(pkg)}`, rule)
  for (const f of files) parts.push('', readFileSync(join(dir, f), 'utf8').trim())
  if (!files.length) parts.push('', `(No license file shipped with this package. Declared license: ${id}.)`)
}
writeFileSync(join(root, 'public', 'licenses.txt'), parts.filter((x) => x !== '').join('\n').replace(/\n(={72})\n/g, '\n\n$1\n') + '\n')
console.log(`licenses.txt generated (${found.size} packages)`)
if (unknown.length) console.warn(`Warning: no license found for ${unknown.join(', ')}`)
