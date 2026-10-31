/// <reference lib="webworker" />
// Heavy lifting runs here so the UI never stutters while a 300-page PDF is being built.
import { PDFDocument, degrees, type PDFImage, type PDFPage } from 'pdf-lib'
import { zipSync } from 'fflate'

interface WorkerSource {
  id: string
  kind: 'pdf' | 'image'
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
  return out.save()
}

self.onmessage = async (e: MessageEvent) => {
  const { id, op, name, pages, sources: incoming } = e.data as {
    id: number
    op: 'merge' | 'split'
    name: string
    pages: JobPage[]
    sources: WorkerSource[]
  }
  for (const s of incoming) sources.set(s.id, s)
  try {
    let files: { name: string; bytes: Uint8Array }[]
    if (op === 'merge') {
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
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, files }, files.map((f) => f.bytes.buffer))
  } catch (err) {
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
