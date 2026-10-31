import type { PDFDocumentProxy } from 'pdfjs-dist'
// Bundled and served from our own origin: no CDN, no third-party request.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Source } from './store'

// pdf.js is ~400 KB, so it stays out of the first paint and loads on idle (or on first drop).
let engine: Promise<typeof import('pdfjs-dist')> | null = null
export function loadPdfEngine() {
  engine ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl
    return m
  })
  return engine
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

export function openPdf(id: string, bytes: Uint8Array) {
  // pdf.js transfers the buffer to its worker, so hand it a copy and keep ours for export.
  const p = loadPdfEngine().then((m) => m.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise)
  docs.set(id, p)
  p.catch(() => docs.delete(id))
  return p
}

// ---- Thumbnails: rendered lazily, a few at a time, cached for the session ----

const THUMB_PX = Math.round(240 * Math.min(window.devicePixelRatio || 1, 2))
const pending = new Map<string, Promise<string>>()
const ready = new Map<string, string>()
const key = (sourceId: string, index: number) => `${sourceId}:${index}`

export const peekThumb = (sourceId: string, index: number) => ready.get(key(sourceId, index)) ?? null

export function getThumb(source: Source, index: number) {
  const k = key(source.id, index)
  let p = pending.get(k)
  if (!p) {
    p = limit(() => (source.kind === 'pdf' ? renderPdfPage(source.id, index) : renderImage(source))).then((url) => {
      ready.set(k, url)
      return url
    })
    p.catch(() => pending.delete(k))
    pending.set(k, p)
  }
  return p
}

async function renderPdfPage(id: string, index: number) {
  const doc = await docs.get(id)
  if (!doc) throw new Error('Document not loaded')
  const page = await doc.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: THUMB_PX / Math.max(base.width, base.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  page.cleanup()
  return toObjectUrl(canvas)
}

async function renderImage(source: Source) {
  const blob = new Blob([source.bytes], { type: source.mime })
  const landscape = (source.width ?? 1) > (source.height ?? 1)
  const bmp = await createImageBitmap(blob, landscape ? { resizeWidth: THUMB_PX } : { resizeHeight: THUMB_PX })
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return toObjectUrl(canvas)
}

const toObjectUrl = (canvas: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Encode failed'))), 'image/jpeg', 0.85),
  )

let active = 0
const queue: (() => void)[] = []
function limit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--
          queue.shift()?.()
        })
    }
    if (active < 3) run()
    else queue.push(run)
  })
}
