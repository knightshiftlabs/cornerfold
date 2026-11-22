// Redaction. A box drawn over text only hides it: the text is still in the file, and anyone can select, search or
// copy it. So a redacted page is not drawn over: it is turned into a picture with the boxes burned into the pixels,
// and that picture replaces the page. What was under a box is then in no layer of the result.
//
// This happens in one place that every export passes through (`withRedactions`, called by the engine and by saving
// pages as images), so there is no way to export a redacted page without it. The export engine also refuses a
// redaction that reaches it (markDraw.ts), which is the last line of defence.
import { forgetSources } from './engine'
import { hasRedactions, redactionsOf } from './marks'
import { placeImage } from './paper'
import { pdfPageSize, renderRedacted } from './pdf'
import { boxesOnPhoto } from './redactGeometry'
import { useStore, type Page, type Source } from './store'

const CACHE_SIZE = 16
/** Finished pictures, so changing an export option does not draw every redacted page again. Oldest first. */
const cache = new Map<string, Source>()

const sha = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const needsRedacting = (pages: readonly Page[]) => pages.some((p) => hasRedactions(p.marks))

async function flatten(page: Page, source: Source): Promise<Source> {
  const { paper } = useStore.getState()
  const boxes = redactionsOf(page.marks)
  const key = JSON.stringify([source.id, page.index, boxes, source.kind === 'image' ? paper : null])
  const id = `redacted-${await sha(key)}`
  const hit = cache.get(id)
  if (hit) {
    cache.delete(id) // most recently used goes to the back
    cache.set(id, hit)
    return hit
  }
  let pointSize: [number, number] | undefined
  let onPicture = boxes
  if (source.kind === 'pdf') pointSize = await pdfPageSize(source, page.index)
  else {
    // A photo sits on the page chosen for photos; the boxes were placed on that page, so map them onto the photo.
    const { page: size, box } = placeImage((source.width ?? 1) * 0.75, (source.height ?? 1) * 0.75, paper)
    onPicture = boxesOnPhoto(boxes, size, box)
  }
  const { bytes, width, height } = await renderRedacted(source, page.index, onPicture)
  const made: Source = { id, name: source.name, kind: 'image', mime: 'image/jpeg', bytes, pageCount: 1, width, height, ...(pointSize ? { pointSize } : {}) }
  cache.set(id, made)
  while (cache.size > CACHE_SIZE) {
    const [oldest] = cache.keys()
    cache.delete(oldest)
    forgetSources([oldest])
  }
  return made
}

/**
 * These pages with every redacted page replaced by its flattened picture (the other marks stay, and are drawn on
 * top as usual), and the sources to use for them. Pages without redactions come back untouched.
 */
export async function withRedactions(pages: Page[]): Promise<{ pages: Page[]; sources: Record<string, Source> }> {
  const sources = { ...useStore.getState().sources }
  if (!needsRedacting(pages)) return { pages, sources }
  const out: Page[] = []
  for (const p of pages) {
    if (!hasRedactions(p.marks)) {
      out.push(p)
      continue
    }
    const flat = await flatten(p, sources[p.sourceId])
    sources[flat.id] = flat
    const marks = (p.marks ?? []).filter((m) => m.kind !== 'redact')
    out.push({ ...p, sourceId: flat.id, index: 0, marks })
  }
  return { pages: out, sources }
}
