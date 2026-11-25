import type { PDFDocumentProxy } from 'pdfjs-dist'
// Bundled and served from our own origin: no CDN, no third-party request.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Source } from './store'
import { pixelBoxes, type Box } from './redactGeometry'
import { findInPieces, snapToInk, type FindOptions, type Hit, type Piece, type Raster } from './findText'

/** The app's code couldn't be loaded, usually because a new version was deployed while this tab was open. */
export class EngineError extends Error {}

// pdf.js is ~400 KB, so it stays out of the first paint and loads on idle (or on first drop).
// Its worker starts at the same time, so both are in memory before any later deploy can replace them.
let engine: Promise<typeof import('pdfjs-dist')> | null = null
let engineFailed: Promise<never> = new Promise(() => {})
export function loadPdfEngine() {
  engine ??= import('pdfjs-dist').then(
    (m) => {
      const worker = new Worker(workerUrl, { type: 'module' })
      engineFailed = new Promise((_, reject) => worker.addEventListener('error', () => reject(new EngineError()), { once: true }))
      engineFailed.catch(() => {}) // handled where documents are opened
      m.GlobalWorkerOptions.workerPort = worker
      return m
    },
    (e) => {
      engine = null // allow a retry
      throw new EngineError(String(e))
    },
  )
  return engine
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

export function openPdf(id: string, bytes: Uint8Array) {
  // pdf.js transfers the buffer to its worker, so hand it a copy and keep ours for export.
  const p = loadPdfEngine().then((m) =>
    Promise.race([m.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise, engineFailed]),
  )
  docs.set(id, p)
  p.catch(() => docs.delete(id))
  return p
}

/** Free everything held for a file that no page, and no undo step, refers to any more. */
export function releaseSource(id: string) {
  docs.get(id)?.then((d) => d.destroy(), () => {})
  docs.delete(id)
  for (const map of [ready, pending] as Map<string, unknown>[]) {
    for (const k of [...map.keys()]) {
      if (!k.startsWith(`${id}:`)) continue
      const url = ready.get(k)
      if (url && map === ready) URL.revokeObjectURL(url)
      map.delete(k)
    }
  }
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
  const ctx = canvas.getContext('2d')!
  // Thumbnails are JPEG, which has no transparency: without paper behind it, a see-through area turns black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return toObjectUrl(canvas)
}

const toBlob = (canvas: HTMLCanvasElement, quality = 0.85, type: 'image/jpeg' | 'image/png' = 'image/jpeg') =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), type, quality))
const toObjectUrl = async (canvas: HTMLCanvasElement, quality = 0.85, type: 'image/jpeg' | 'image/png' = 'image/jpeg') => URL.createObjectURL(await toBlob(canvas, quality, type))

/**
 * A large, sharp picture of one page for the preview, already turned by `rotation` degrees, with its longest
 * side `longPx` pixels. The caller revokes the URL when done with it.
 */
export async function renderLarge(source: Source, index: number, rotation: number, longPx: number) {
  return URL.createObjectURL(await drawPage(source, index, rotation, longPx, 'image/jpeg'))
}

/** One page drawn as an image file, already turned by `rotation` degrees, with its longest side `longPx` pixels. */
async function drawPage(source: Source, index: number, rotation: number, longPx: number, type: 'image/jpeg' | 'image/png', paint?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void) {
  const turn = ((rotation % 360) + 360) % 360
  const canvas = document.createElement('canvas')
  try {
    if (source.kind === 'pdf') {
      const doc = await docs.get(source.id)
      if (!doc) throw new Error('Document not loaded')
      const page = await doc.getPage(index + 1)
      const angle = (page.rotate + turn) % 360
      const base = page.getViewport({ scale: 1, rotation: angle })
      const viewport = page.getViewport({ scale: longPx / Math.max(base.width, base.height), rotation: angle })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
      page.cleanup()
    } else {
      const landscape = (source.width ?? 1) >= (source.height ?? 1)
      const bmp = await createImageBitmap(new Blob([source.bytes], { type: source.mime }), landscape ? { resizeWidth: longPx } : { resizeHeight: longPx })
      const quarter = turn % 180 !== 0
      canvas.width = quarter ? bmp.height : bmp.width
      canvas.height = quarter ? bmp.width : bmp.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff' // the paper behind any see-through part, as in the exported PDF
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((turn * Math.PI) / 180)
      ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
      bmp.close()
    }
    paint?.(canvas.getContext('2d')!, canvas.width, canvas.height)
    return await toBlob(canvas, 0.92, type)
  } finally {
    canvas.width = canvas.height = 0
  }
}

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

/** The longest side, in pixels, of a page saved as an image: 300 dpi on A1 paper. Bigger uses too much memory. */
const MAX_IMAGE_PX = 10_000

/**
 * One page as an image file, already turned by `rotation` degrees. PDF pages are drawn at `dpi`; photos are
 * saved at their own pixels, since drawing them bigger adds no detail.
 */
export async function renderPageImage(source: Source, index: number, rotation: number, dpi: number, type: 'image/jpeg' | 'image/png') {
  const turn = ((rotation % 360) + 360) % 360
  let longPx: number
  if (source.kind === 'pdf') {
    const doc = await docs.get(source.id)
    if (!doc) throw new Error('Document not loaded')
    const page = await doc.getPage(index + 1)
    const base = page.getViewport({ scale: 1 })
    longPx = Math.min(MAX_IMAGE_PX, Math.round((Math.max(base.width, base.height) * dpi) / 72))
  } else longPx = Math.max(source.width ?? 1, source.height ?? 1)
  // The bytes come straight from the drawing. (Reading them back with fetch() is blocked by the site's
  // security policy, which allows no fetching at all: that was a bug in 1.3.0.)
  return new Uint8Array(await (await drawPage(source, index, turn, longPx, type)).arrayBuffer())
}

/** The longest side of a redacted page's picture: 200 dpi on A4, and never more than this, so memory stays in check. */
const REDACT_DPI = 200
const REDACT_MAX_PX = 5000

/**
 * One page drawn as a picture with black boxes burned into its pixels, so what they cover exists nowhere in the
 * result. `boxes` are fractions of the picture. A PDF page is drawn at 200 dpi (as it is seen, with its own built-in
 * turn); a photo at its own pixels. Returns the JPEG and its size in pixels.
 */
export async function renderRedacted(source: Source, index: number, boxes: Box[]) {
  let longPx: number
  if (source.kind === 'pdf') {
    const doc = await docs.get(source.id)
    if (!doc) throw new Error('Document not loaded')
    const base = (await doc.getPage(index + 1)).getViewport({ scale: 1 })
    longPx = Math.min(REDACT_MAX_PX, Math.round((Math.max(base.width, base.height) * REDACT_DPI) / 72))
  } else longPx = Math.max(source.width ?? 1, source.height ?? 1)
  let size: [number, number] = [0, 0]
  const blob = await drawPage(source, index, 0, longPx, 'image/jpeg', (ctx, w, h) => {
    size = [w, h]
    ctx.fillStyle = '#000'
    for (const [x, y, bw, bh] of pixelBoxes(boxes, w, h)) ctx.fillRect(x, y, bw, bh)
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: size[0], height: size[1] }
}

/** The text on one page, as plain lines. Pages that are pictures (scans, photos) have none. */
export async function pageText(source: Source, index: number) {
  if (source.kind !== 'pdf') return ''
  const doc = await docs.get(source.id)
  if (!doc) throw new Error('Document not loaded')
  const page = await doc.getPage(index + 1)
  const content = await page.getTextContent()
  page.cleanup()
  const { textFromItems } = await import('./text')
  return textFromItems(content.items.filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i) as never)
}

let measuring: CanvasRenderingContext2D | null | undefined
/** How wide text is in the font family pdf.js names for it (or a plain one), in any one unit. */
const measureText = (str: string, piece: { family?: string }) => {
  if (measuring === undefined) measuring = document.createElement('canvas').getContext('2d')
  if (!measuring) return str.length
  measuring.font = `100px ${piece.family || 'sans-serif'}`
  return measuring.measureText(str).width
}

/**
 * Where words appear on one page, as boxes ready to be redacted. `hasText` says whether the page has any text to
 * search at all: a scan or a photo has none, however many words can be read on it by eye.
 */
export async function pageMatches(source: Source, index: number, query: string, options: FindOptions): Promise<{ hasText: boolean; hits: Hit[] }> {
  if (source.kind !== 'pdf') return { hasText: false, hits: [] }
  const doc = await docs.get(source.id)
  if (!doc) throw new Error('Document not loaded')
  const page = await doc.getPage(index + 1)
  try {
    const vp = page.getViewport({ scale: 1 }) // includes the page's own built-in turn, as marks do
    const content = await page.getTextContent()
    const pieces: Piece[] = content.items
      .filter((i): i is typeof i & { str: string; transform: number[]; width: number; height: number; fontName: string; hasEOL?: boolean } => 'str' in i)
      .map((i) => ({ str: i.str, transform: i.transform, width: i.width, height: i.height, hasEOL: i.hasEOL, family: content.styles[i.fontName]?.fontFamily }))
    const hasText = pieces.some((p) => p.str.trim())
    const toFraction = (x: number, y: number): [number, number] => {
      const [vx, vy] = vp.convertToViewportPoint(x, y)
      return [vx / vp.width, vy / vp.height]
    }
    const hits = hasText ? findInPieces(pieces, query, options, measureText, toFraction) : []
    if (hits.some((h) => h.upright)) {
      // Look at the page itself, so no box ends halfway through a letter.
      let raster: Raster | null = null
      await drawPage(source, index, 0, 2000, 'image/jpeg', (ctx, width, height) => {
        raster = ctx.getImageData(0, 0, width, height)
      })
      if (raster) for (const h of hits)
        if (h.upright)
          h.boxes = h.boxes.map((b, i) => snapToInk(b, raster!, { left: i === 0 && h.startsWord ? 'word' : 'letter', right: i === h.boxes.length - 1 && h.endsWord ? 'word' : 'letter' }))
    }
    return { hasText, hits }
  } finally {
    page.cleanup()
  }
}

/** A form field on a page, placed as fractions of the page as it appears (before any turn added in Cornerfold). */
export interface FormField {
  name: string
  /** What the field is for, in words: the form's own description of it, or its name tidied up. */
  label: string
  kind: 'text' | 'checkbox' | 'radio' | 'choice'
  x: number
  y: number
  w: number
  h: number
  /** Text, the chosen option, or whether a box is ticked. */
  value: string | boolean
  /** For a radio button, the option it stands for. */
  option?: string
  options?: { value: string; label: string }[]
  multiline?: boolean
  readOnly?: boolean
}

/** The form fields on one page, read by pdf.js. Pages without a form have none. */
export async function pageFields(source: Source, index: number): Promise<FormField[]> {
  if (source.kind !== 'pdf') return []
  const doc = await docs.get(source.id)
  if (!doc) return []
  const page = await doc.getPage(index + 1)
  const vp = page.getViewport({ scale: 1 }) // includes the page's own built-in turn, as marks do
  const annotations = await page.getAnnotations({ intent: 'display' })
  const found = annotations.flatMap((a): FormField[] => {
    if (a.subtype !== 'Widget' || !a.fieldName || a.pushButton || a.hidden) return []
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect)
    const tidy = String(a.fieldName).split('.').pop()!.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
    const label = String(a.alternativeText || tidy || a.fieldName)
    const box = { name: a.fieldName as string, label, x: Math.min(x1, x2) / vp.width, y: Math.min(y1, y2) / vp.height, w: Math.abs(x2 - x1) / vp.width, h: Math.abs(y2 - y1) / vp.height, readOnly: !!a.readOnly }
    if (a.fieldType === 'Tx') return [{ ...box, kind: 'text', value: String(a.fieldValue ?? ''), multiline: !!a.multiLine }]
    if (a.fieldType === 'Btn' && a.checkBox) return [{ ...box, kind: 'checkbox', value: !!a.fieldValue && a.fieldValue !== 'Off' }]
    if (a.fieldType === 'Btn' && a.radioButton) return [{ ...box, kind: 'radio', value: String(a.fieldValue ?? ''), option: String(a.buttonValue ?? '') }]
    if (a.fieldType === 'Ch')
      return [{ ...box, kind: 'choice', value: String((Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue) ?? ''), options: (a.options ?? []).map((o: { exportValue: string; displayValue: string }) => ({ value: o.exportValue, label: o.displayValue })) }]
    return []
  })
  // Radio buttons say which of their group they are: "option 2 of 3".
  for (const f of found.filter((f) => f.kind === 'radio')) {
    const group = found.filter((g) => g.kind === 'radio' && g.name === f.name)
    f.label = `${f.label}, option ${group.indexOf(f) + 1} of ${group.length}`
  }
  return found
}

/** A PDF page's size in points, as it appears before any turn added in Cornerfold. */
export async function pdfPageSize(source: Source, index: number): Promise<[number, number]> {
  const doc = await docs.get(source.id)
  if (!doc) throw new Error('Document not loaded')
  const vp = (await doc.getPage(index + 1)).getViewport({ scale: 1 })
  return [vp.width, vp.height]
}
