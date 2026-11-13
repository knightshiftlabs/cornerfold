/// <reference lib="webworker" />
// Heavy lifting runs here so the UI never stutters while a 300-page PDF is being built.
import { unlockPdf } from './unlock'
import { DEFAULT_PAPER, placeImage, type Paper } from './paper'
import { applyStamps, type Stamps } from './stamp'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFObjectCopier, PDFRef, PDFString, degrees, type PDFImage, type PDFPage } from '@cantoo/pdf-lib'
import { zipSync } from 'fflate'
import { Compressor, PRESETS, budgetsFor, type Codec } from './compress'

interface WorkerSource {
  id: string
  kind: 'pdf' | 'image'
  pageCount: number
  bytes: Uint8Array
  mime?: string
  width?: number
  height?: number
}
interface JobPage {
  sourceId: string
  index: number
  rotation: number
}

const sources = new Map<string, WorkerSource>()
const parsed = new Map<string, Promise<PDFDocument>>()
const normalize = (deg: number) => ((deg % 360) + 360) % 360

function loadSource(id: string) {
  let doc = parsed.get(id)
  if (!doc) {
    const s = sources.get(id)
    if (!s) throw new Error('Source missing in worker')
    doc = PDFDocument.load(s.bytes, { updateMetadata: false })
    parsed.set(id, doc)
  }
  return doc
}

async function build(pages: JobPage[], paper: Paper = DEFAULT_PAPER) {
  return (await assemble(pages, paper)).save()
}

/** The pages in order, as a document that can still be drawn on before it is saved. */
async function assemble(pages: JobPage[], paper: Paper) {
  // No producer/creator stamps, and source metadata (author, etc.) is not carried over.
  const out = await PDFDocument.create({ updateMetadata: false })

  // Copy each source's pages in one call so shared fonts and images are embedded once.
  const wanted = new Map<string, number[]>()
  for (const p of pages) {
    if (sources.get(p.sourceId)?.kind !== 'pdf') continue
    if (!wanted.has(p.sourceId)) wanted.set(p.sourceId, [])
    wanted.get(p.sourceId)!.push(p.index)
  }
  const copies = new Map<string, PDFPage[]>()
  for (const [sid, indices] of wanted) {
    const copied = await out.copyPages(await loadSource(sid), indices)
    indices.forEach((ix, i) => {
      const k = `${sid}:${ix}`
      if (!copies.has(k)) copies.set(k, [])
      copies.get(k)!.push(copied[i])
    })
  }

  const images = new Map<string, PDFImage>()
  for (const p of pages) {
    const s = sources.get(p.sourceId)!
    let page: PDFPage
    if (s.kind === 'pdf') {
      page = out.addPage(copies.get(`${p.sourceId}:${p.index}`)!.shift()!)
    } else {
      let img = images.get(s.id)
      if (!img) {
        img = s.mime === 'image/jpeg' ? await out.embedJpg(s.bytes) : await out.embedPng(s.bytes)
        images.set(s.id, img)
      }
      // 96 dpi pixels to PDF points, then onto the paper chosen for photos
      const { page: size, box } = placeImage(s.width! * 0.75, s.height! * 0.75, paper)
      page = out.addPage(size)
      page.drawImage(img, box)
    }
    if (normalize(p.rotation)) page.setRotation(degrees(normalize(page.getRotation().angle + p.rotation)))
  }
  await rebuildForm(out, [...wanted.keys()])
  return out
}

/** A page's size as it is seen, in points: turned pages have their width and height swapped. */
async function visualSize(p: JobPage): Promise<[number, number]> {
  const s = sources.get(p.sourceId)
  if (!s) throw new Error('Source missing in worker')
  let width = (s.width ?? 0) * 0.75
  let height = (s.height ?? 0) * 0.75
  let turn = p.rotation
  if (s.kind === 'pdf') {
    const page = (await loadSource(s.id)).getPage(p.index)
    ;({ width, height } = page.getSize())
    turn += page.getRotation().angle
  }
  return normalize(turn) % 180 ? [height, width] : [width, height]
}

const A4: [number, number] = [595.28, 841.89]

/** An empty page, the same size as the page it will sit next to (A4 when there is none). */
async function blankPage(like: JobPage | undefined) {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.addPage(like ? await visualSize(like) : A4)
  return doc.save()
}

/**
 * Splits pages into consecutive parts that each stay under `maxBytes`. A page on its own is a safe upper
 * limit for what it adds to a part (parts share fonts and images, so they come out smaller than the sum),
 * which keeps every part under the limit without building each one twice. A page that is over the limit
 * by itself gets a part of its own.
 */
async function packBySize(pages: JobPage[], maxBytes: number, paper: Paper) {
  const groups: number[][] = []
  let current: number[] = []
  let size = 0
  let oversize = 0
  for (let i = 0; i < pages.length; i++) {
    const alone = (await build([pages[i]], paper)).length
    if (alone > maxBytes) oversize++
    if (current.length && size + alone > maxBytes) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(i)
    size += alone
  }
  if (current.length) groups.push(current)
  return { groups, oversize }
}

/**
 * Copying pages brings their form fields along, but not the document-level form that makes
 * them editable. Rebuild it from the fields that actually landed in the output.
 */
async function rebuildForm(out: PDFDocument, sourceIds: string[]) {
  const N = PDFName.of
  const roots: PDFRef[] = []
  const seen = new Set<string>()
  for (const page of out.getPages()) {
    const annots = page.node.lookup(N('Annots'))
    if (!(annots instanceof PDFArray)) continue
    for (let i = 0; i < annots.size(); i++) {
      const first = annots.get(i)
      if (!(first instanceof PDFRef)) continue
      const widget = out.context.lookup(first)
      if (!(widget instanceof PDFDict) || widget.get(N('Subtype'))?.toString() !== '/Widget') continue
      // Climb to the top of the field tree; that's what the form lists.
      let ref: PDFRef = first
      let node: PDFDict = widget
      for (let hops = 0; hops < 32; hops++) {
        const parent = node.get(N('Parent'))
        if (!(parent instanceof PDFRef)) break
        const next = out.context.lookup(parent)
        if (!(next instanceof PDFDict)) break
        ref = parent
        node = next
      }
      const key = `${ref.objectNumber} ${ref.generationNumber}`
      if (!seen.has(key)) {
        seen.add(key)
        roots.push(ref)
      }
    }
  }
  if (!roots.length) return

  // Fields that share a name are one field to a PDF viewer: typing in one changes the other. Two copies of the
  // same form (two applicants, say) must stay independent, so later ones get a number: name, name_2, name_3.
  const used = new Set<string>()
  for (const ref of roots) {
    const field = out.context.lookup(ref)
    if (!(field instanceof PDFDict)) continue
    const title = field.get(N('T'))
    const name = title instanceof PDFString || title instanceof PDFHexString ? title.decodeText() : undefined
    if (name === undefined) continue
    let unique = name
    for (let n = 2; used.has(unique); n++) unique = `${name}_${n}`
    used.add(unique)
    if (unique !== name) field.set(N('T'), PDFHexString.fromText(unique))
  }

  const form = out.context.obj({ Fields: roots })
  // Carry over the first source form's default appearance and fonts, so fields stay editable.
  for (const sid of sourceIds) {
    const src = await loadSource(sid)
    const acro = src.catalog.lookup(N('AcroForm'))
    if (!(acro instanceof PDFDict)) continue
    const copier = PDFObjectCopier.for(src.context, out.context)
    for (const k of ['DA', 'DR', 'Q', 'NeedAppearances']) {
      const v = acro.get(N(k))
      if (v) form.set(N(k), copier.copy(v))
    }
    break
  }
  out.catalog.set(N('AcroForm'), out.context.register(form))
}

// ---- Compression ----

const browserCodec: Codec<ImageBitmap> = {
  decodeJpeg: (bytes) => createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })),
  fromRGBA: (rgba, w, h) => createImageBitmap(new ImageData(rgba, w, h)),
  async encodeJpeg(src, w, h, quality) {
    const canvas = new OffscreenCanvas(w, h)
    try {
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, 0, 0, w, h)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      return new Uint8Array(await blob.arrayBuffer())
    } finally {
      canvas.width = canvas.height = 0 // give the canvas's pixels back now, not whenever the browser next collects garbage
    }
  },
  release: (bitmap) => bitmap.close(),
}

/** One compression session per page arrangement, so presets and size targets reuse decoded images. */
let session: { key: string; compressor: Promise<Compressor<ImageBitmap>> } | null = null

/** Ends the current session and frees the pictures it was keeping. */
function endSession() {
  const old = session
  session = null
  old?.compressor.then((c) => c.dispose(), () => {})
}

function compressorFor(pages: JobPage[], paper: Paper) {
  const key = JSON.stringify([pages, paper])
  if (session?.key !== key) {
    endSession()
    const compressor = (async () => {
        // A single, untouched PDF is compressed as-is, which keeps its bookmarks and form fields.
        const first = sources.get(pages[0]?.sourceId)
        const untouched =
          first?.kind === 'pdf' &&
          pages.length === first.pageCount &&
          pages.every((p, i) => p.sourceId === first.id && p.index === i && normalize(p.rotation) === 0)
        const base = untouched ? first.bytes : await build(pages, paper)
        const c = new Compressor(base, browserCodec, budgetsFor((navigator as { deviceMemory?: number }).deviceMemory))
        await c.init()
        return c
      })()
    // If it can't be set up, forget it, so asking again starts afresh instead of repeating the same failure.
    compressor.catch(() => {
      if (session?.compressor === compressor) session = null
    })
    session = { key, compressor }
  }
  return session!.compressor
}

self.onmessage = async (e: MessageEvent) => {
  if (e.data.op === 'forget') {
    for (const sid of e.data.ids as string[]) {
      sources.delete(sid)
      parsed.delete(sid)
    }
    endSession()
    return
  }
  if (e.data.op === 'unlock') {
    const { id, bytes, password } = e.data as { id: number; bytes: Uint8Array; password: string }
    try {
      const unlock = await unlockPdf(bytes, password)
      const transfer = unlock.status === 'ok' ? [unlock.bytes.buffer] : []
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, unlock }, transfer)
    } catch (err) {
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  const { id, op, name, pages, sources: incoming, options } = e.data as {
    id: number
    op: 'merge' | 'split' | 'compress' | 'blank' | 'stamp'
    name: string
    pages: JobPage[]
    sources: WorkerSource[]
    options?: { preset?: keyof typeof PRESETS; target?: number; groups?: number[][]; maxBytes?: number; paper?: Paper; stamps?: Stamps }
  }
  const paper = options?.paper ?? DEFAULT_PAPER
  for (const s of incoming) sources.set(s.id, s)
  try {
    let files: { name: string; bytes: Uint8Array }[]
    let stats: { original: number; size: number; met: boolean } | undefined
    let info: { parts: number; oversize: number } | undefined
    if (op === 'blank') {
      files = [{ name, bytes: await blankPage(pages[0]) }]
    } else if (op === 'stamp') {
      const doc = await assemble(pages, paper)
      await applyStamps(doc, options?.stamps ?? {})
      files = [{ name, bytes: await doc.save() }]
    } else if (op === 'compress') {
      const c = await compressorFor(pages, paper)
      let bytes: Uint8Array
      let met = true
      if (options?.target) ({ bytes, met } = await c.fitUnder(options.target))
      else bytes = await c.run(PRESETS[options?.preset ?? 'balanced'])
      // Always send a copy: transferring would detach buffers the session keeps for reuse.
      bytes = bytes.slice()
      files = [{ name, bytes }]
      stats = { original: c.source.length, size: bytes.length, met }
    } else if (op === 'merge') {
      files = [{ name, bytes: await build(pages, paper) }]
    } else {
      // One PDF per page by default; or one per group of pages; or as many pages per part as fit under a size.
      let groups = options?.groups ?? pages.map((_, i) => [i])
      let oversize = 0
      if (options?.maxBytes) ({ groups, oversize } = await packBySize(pages, options.maxBytes, paper))
      const single = groups.every((g) => g.length === 1)
      const width = Math.max(2, String(groups.length).length)
      const entries: Record<string, Uint8Array> = {}
      for (let i = 0; i < groups.length; i++) {
        const label = `${single ? 'p' : 'part-'}${String(i + 1).padStart(width, '0')}`
        entries[`${name}-${label}.pdf`] = await build(groups[i].map((ix) => pages[ix]), paper)
      }
      // PDFs are already compressed; store them as-is for speed.
      files = [{ name: `${name}-${single ? 'pages' : 'parts'}.zip`, bytes: zipSync(entries, { level: 0 }) }]
      info = { parts: groups.length, oversize }
    }
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, files, stats, info }, files.map((f) => f.bytes.buffer))
  } catch (err) {
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
