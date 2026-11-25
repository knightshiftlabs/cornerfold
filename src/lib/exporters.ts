// Saving pages as images or text, and exporting with page numbers or a watermark. Loaded with the tool panels.
import { zipSync } from 'fflate'
import { baseName, download, message, targets } from './actions'
import { runJob } from './engine'
import { checkZipBudget } from './exportBudget'
import { pagePictures, pageText, renderPageImage } from './pdf'
import { hasRedactions } from './marks'
import { useStore } from './store'
import { combineText } from './text'
import type { ProtectOptions } from './protect'
import type { Stamps } from './stampText'

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`
const pad = (n: number, total: number) => String(n).padStart(Math.max(2, String(total).length), '0')

/** Saves each page (the selection, or all) as an image: one image as it is, several in a ZIP. */
export async function saveImages(format: 'jpg' | 'png', dpi: number) {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  const base = baseName(list)
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const files: Record<string, Uint8Array> = {}
  let made = 0
  try {
    // Redacted pages are saved from their flattened picture, never from the page itself (see lib/redact.ts).
    st.setBusy('Applying redactions')
    const { pages: flat, sources } = await (await import('./redact')).withRedactions(list)
    for (let i = 0; i < flat.length; i++) {
      st.setBusy(`Saving page ${i + 1} of ${list.length}`)
      const p = flat[i]
      files[`${base}-page-${pad(i + 1, list.length)}.${format}`] = await renderPageImage(sources[p.sourceId], p.index, p.rotation, dpi, type)
      made += files[Object.keys(files).at(-1)!].length
      checkZipBudget(i + 1, list.length, made, 'Save fewer pages at a time, or choose a lower detail.')
    }
    const names = Object.keys(files)
    if (names.length === 1) {
      download(files[names[0]], names[0], type)
      return st.notify(`Saved ${names[0]}`)
    }
    const zipName = `${base}-images.zip`
    download(zipSync(files, { level: 0 }), zipName, 'application/zip') // images are already compressed
    st.notify(`Saved ${count(names.length, 'image')} as ${zipName}`)
  } catch (e) {
    st.notify(`Couldn’t save the images: ${message(e)}`, { tone: 'error' })
  } finally {
    useStore.getState().setBusy(null)
  }
}

/**
 * Saves the pictures stored in the pages (the selection, or all) as PNG files. A page added from a photo gives that
 * photo. Pages with a redaction box are skipped entirely, so nothing under a box can come out this way.
 * Returns what happened, for the panel to say.
 */
export async function savePictures(): Promise<{ saved: number; redactedSkipped: number } | null> {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return null
  const base = baseName(list)
  const { pictureName } = await import('./pictures')
  const files: Record<string, Uint8Array> = {}
  const seen = new Map<string, Set<string>>() // per file: pictures already taken
  const photos = new Set<string>()
  const pagesDone = new Set<string>() // a page included twice gives its pictures once
  const hashes = new Set<string>() // and a picture stored twice in a file comes out once
  const digest = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')
  let made = 0
  let redactedSkipped = 0
  try {
    for (let i = 0; i < list.length; i++) {
      st.setBusy(`Looking for pictures on page ${i + 1} of ${list.length}`)
      const p = list[i]
      if (hasRedactions(p.marks)) {
        redactedSkipped++
        continue
      }
      const source = st.sources[p.sourceId]
      let found: { bytes: Uint8Array; ext: string }[]
      if (source.kind === 'image') {
        if (photos.has(source.id)) continue
        photos.add(source.id)
        found = [{ bytes: source.bytes, ext: source.mime === 'image/png' ? 'png' : 'jpg' }]
      } else {
        if (pagesDone.has(`${source.id}:${p.index}`)) continue
        pagesDone.add(`${source.id}:${p.index}`)
        if (!seen.has(source.id)) seen.set(source.id, new Set())
        found = (await pagePictures(source, p.index, seen.get(source.id)!)).map((x) => ({ bytes: x.png, ext: 'png' }))
      }
      let n = 0
      for (const f of found) {
        const h = await digest(f.bytes)
        if (hashes.has(h)) continue
        hashes.add(h)
        files[pictureName(base, i + 1, ++n, list.length, f.ext)] = f.bytes
        made += f.bytes.length
      }
      checkZipBudget(i + 1, list.length, made, 'Choose fewer pages at a time.')
    }
    const names = Object.keys(files)
    if (!names.length) {
      st.notify(redactedSkipped ? 'No pictures found, apart from pages with redactions, which are skipped.' : 'No pictures found in these pages.')
      return { saved: 0, redactedSkipped }
    }
    if (names.length === 1) download(files[names[0]], names[0], names[0].endsWith('.png') ? 'image/png' : 'image/jpeg')
    else download(zipSync(files, { level: 0 }), `${base}-pictures.zip`, 'application/zip')
    const skipped = redactedSkipped ? ` ${count(redactedSkipped, 'page')} with redactions skipped.` : ''
    st.notify(`Saved ${count(names.length, 'picture')}${names.length === 1 ? ` as ${names[0]}` : ` as ${base}-pictures.zip`}.${skipped}`)
    return { saved: names.length, redactedSkipped }
  } catch (e) {
    st.notify(`Couldn’t save the pictures: ${message(e)}`, { tone: 'error' })
    return null
  } finally {
    useStore.getState().setBusy(null)
  }
}

/** Reads the text of each page (the selection, or all), in order. */
export async function collectText() {
  const st = useStore.getState()
  const list = targets()
  const parts = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    // The text of a redacted page is what redaction removes, so it is never read.
    if (hasRedactions(p.marks)) {
      parts.push({ page: i + 1, text: '' })
      continue
    }
    parts.push(await pageText(st.sources[p.sourceId], p.index).then((text) => ({ page: i + 1, text }), () => ({ page: i + 1, text: '', failed: true })))
  }
  return { ...combineText(parts), total: list.length, name: `${baseName(list)}.txt` }
}

/** Exports (the selection, or all) locked with a password. Redactions and filled-in answers are applied first, as for any export. */
export async function exportProtected(options: ProtectOptions) {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return false
  const base = baseName(list)
  const name = `${base === 'merged' ? 'merged' : base}-protected.pdf`
  st.setBusy('Exporting')
  try {
    const [file] = (await runJob('merge', list, name)).files
    st.setBusy('Locking with the password')
    const { protectPdf } = await import('./protect')
    download(await protectPdf(file.bytes, options), name, 'application/pdf')
    st.notify(`Exported ${name}, locked with your password`)
    return true
  } catch (e) {
    st.notify(`Couldn’t lock the file: ${message(e)}`, { tone: 'error' })
    return false
  } finally {
    useStore.getState().setBusy(null)
  }
}

/** Exports (the selection, or all) with page numbers or a watermark drawn on, or trimmed or resized. The pages here are not changed. */
export async function exportStamped(stamps: Stamps) {
  const st = useStore.getState()
  const list = targets()
  if (st.busy || !list.length) return
  const what = stamps.layout ? (stamps.layout.kind === 'trim' ? 'trimmed' : 'resized') : stamps.watermark ? 'watermarked' : 'numbered'
  const name = `${baseName(list)}-${what}.pdf`
  st.setBusy('Exporting')
  try {
    const [file] = (await runJob('stamp', list, name, { stamps })).files
    download(file.bytes, file.name, 'application/pdf')
    st.notify(`Exported ${file.name}`)
  } catch (e) {
    st.notify(`Export failed: ${message(e)}`, { tone: 'error' })
  } finally {
    useStore.getState().setBusy(null)
  }
}
