/// <reference lib="webworker" />
// Heavy lifting runs here so the UI never stutters while a 300-page PDF is being built.
import { unlockPdf } from './unlock'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObjectCopier, PDFRef, degrees, type PDFImage, type PDFPage } from '@cantoo/pdf-lib'
import { zipSync } from 'fflate'
import { Compressor, PRESETS, type Codec } from './compress'

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

async function build(pages: JobPage[]) {
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
      // 96 dpi pixels to PDF points
      const w = s.width! * 0.75
      const h = s.height! * 0.75
      page = out.addPage([w, h])
      page.drawImage(img, { x: 0, y: 0, width: w, height: h })
    }
    if (normalize(p.rotation)) page.setRotation(degrees(normalize(page.getRotation().angle + p.rotation)))
  }
  await rebuildForm(out, [...wanted.keys()])
  return out.save()
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
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, w, h)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return new Uint8Array(await blob.arrayBuffer())
  },
}

/** One compression session per page arrangement, so presets and size targets reuse decoded images. */
let session: { key: string; compressor: Promise<Compressor<ImageBitmap>> } | null = null

function compressorFor(pages: JobPage[]) {
  const key = JSON.stringify(pages)
  if (session?.key !== key) {
    session = {
      key,
      compressor: (async () => {
        // A single, untouched PDF is compressed as-is, which keeps its bookmarks and form fields.
        const first = sources.get(pages[0]?.sourceId)
        const untouched =
          first?.kind === 'pdf' &&
          pages.length === first.pageCount &&
          pages.every((p, i) => p.sourceId === first.id && p.index === i && normalize(p.rotation) === 0)
        const base = untouched ? first.bytes : await build(pages)
        const c = new Compressor(base, browserCodec)
        await c.init()
        return c
      })(),
    }
  }
  return session.compressor
}

self.onmessage = async (e: MessageEvent) => {
  if (e.data.op === 'forget') {
    for (const sid of e.data.ids as string[]) {
      sources.delete(sid)
      parsed.delete(sid)
    }
    session = null
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
    op: 'merge' | 'split' | 'compress'
    name: string
    pages: JobPage[]
    sources: WorkerSource[]
    options?: { preset?: keyof typeof PRESETS; target?: number }
  }
  for (const s of incoming) sources.set(s.id, s)
  try {
    let files: { name: string; bytes: Uint8Array }[]
    let stats: { original: number; size: number; met: boolean } | undefined
    if (op === 'compress') {
      const c = await compressorFor(pages)
      let bytes: Uint8Array
      let met = true
      if (options?.target) ({ bytes, met } = await c.fitUnder(options.target))
      else bytes = await c.run(PRESETS[options?.preset ?? 'balanced'])
      // Always send a copy: transferring would detach buffers the session keeps for reuse.
      bytes = bytes.slice()
      files = [{ name, bytes }]
      stats = { original: c.source.length, size: bytes.length, met }
    } else if (op === 'merge') {
      files = [{ name, bytes: await build(pages) }]
    } else {
      const width = Math.max(2, String(pages.length).length)
      const entries: Record<string, Uint8Array> = {}
      for (let i = 0; i < pages.length; i++) {
        entries[`${name}-p${String(i + 1).padStart(width, '0')}.pdf`] = await build([pages[i]])
      }
      // PDFs are already compressed; store them as-is for speed.
      files = [{ name: `${name}-pages.zip`, bytes: zipSync(entries, { level: 0 }) }]
    }
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, files, stats }, files.map((f) => f.bytes.buffer))
  } catch (err) {
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
