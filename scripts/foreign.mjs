// Finds what a page loads from another site. Used by the live check (scripts/check-live.mjs) and tested on its own
// (tests/foreign.test.ts), so the check cannot quietly miss something. It reads each tag's own attributes: a
// canonical or alternate <link> is only a pointer, so only that tag is exempt, never the rest of the page.

const LOADING_TAGS = 'script|link|img|iframe|source|embed|object|audio|video|track|input|image|use'
const URL_ATTRS = new Set(['src', 'href', 'data', 'poster', 'action', 'formaction', 'xlink:href'])
const POINTERS = new Set(['canonical', 'alternate'])

/** Every attribute of one tag, with quotes of either kind or none. */
function attributes(text) {
  const out = {}
  for (const [, name, double, single, bare] of text.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) out[name.toLowerCase()] = double ?? single ?? bare ?? ''
  return out
}

/** The addresses a tag loads: its src, href and the like, and each address in a srcset. */
function addressesOf(attrs) {
  const urls = Object.entries(attrs).filter(([k]) => URL_ATTRS.has(k)).map(([, v]) => v)
  for (const k of ['srcset', 'imagesrcset']) if (attrs[k]) urls.push(...attrs[k].split(',').map((part) => part.trim().split(/\s+/)[0]))
  return urls.filter(Boolean)
}

/** The tags of a page that load something from outside `origin`, as "<tag> from host". */
export function foreignResources(html, origin) {
  const found = []
  const check = (tag, raw) => {
    let url
    try {
      url = new URL(raw.trim(), origin)
    } catch {
      return
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== new URL(origin).origin) found.push(`<${tag}> from ${url.host}`)
  }
  for (const [, tag, body] of html.matchAll(new RegExp(`<(${LOADING_TAGS})\\b([^>]*)>`, 'gi'))) {
    const attrs = attributes(body)
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (tag.toLowerCase() === 'link' && rel.length && rel.every((r) => POINTERS.has(r))) continue
    for (const raw of addressesOf(attrs)) check(tag.toLowerCase(), raw)
  }
  // Styles can load things too: url(...) and @import, in a <style> block or a style attribute.
  for (const [, , raw] of html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) check('style', raw)
  for (const [, , raw] of html.matchAll(/@import\s+(["'])([^"']+)\1/gi)) check('style', raw)
  return found
}
