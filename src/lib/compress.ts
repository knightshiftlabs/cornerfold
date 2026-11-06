// Image-aware PDF compression. Text and vector graphics are never touched:
// we only re-encode raster images that are larger than they need to be.
// The image codec is injected, so this runs in a browser worker (OffscreenCanvas)
// and in Node tests alike.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from '@cantoo/pdf-lib'
import { unzlibSync } from 'fflate'

export interface Codec<B extends { width: number; height: number }> {
  decodeJpeg(bytes: Uint8Array): Promise<B>
  fromRGBA(rgba: Uint8ClampedArray, width: number, height: number): Promise<B>
  encodeJpeg(src: B, width: number, height: number, quality: number): Promise<Uint8Array>
  /** Frees a picture's memory straight away, instead of waiting for the browser's garbage collection. */
  release?(bitmap: B): void
}

/**
 * How much the compressor may keep between runs, so presets and size searches don't decode the same
 * pictures over and over. Decoded pictures are the big cost: an A4 scan at 300 dpi is about 33 MB once
 * decoded. Beyond the budget a picture is decoded again when needed and freed as soon as it has been used.
 */
export interface Budgets {
  /** Decoded pixels kept (4 bytes each). */
  decodedPixels: number
  /** Bytes of already-compressed pictures kept. */
  encodedBytes: number
}
export const DEFAULT_BUDGETS: Budgets = { decodedPixels: 48_000_000, encodedBytes: 96 * 1024 * 1024 }

/**
 * Smaller budgets for devices that report little memory (in gigabytes, as Chrome does). Where the browser
 * says nothing, as Safari and Firefox don't, the default applies.
 */
export function budgetsFor(deviceMemoryGb?: number): Budgets {
  if (!deviceMemoryGb || deviceMemoryGb > 4) return DEFAULT_BUDGETS
  if (deviceMemoryGb > 2) return { decodedPixels: 24_000_000, encodedBytes: 48 * 1024 * 1024 }
  return { decodedPixels: 12_000_000, encodedBytes: 24 * 1024 * 1024 }
}

export interface Params {
  dpi: number
  quality: number
}

export const PRESETS = {
  light: { dpi: 200, quality: 0.8 },
  balanced: { dpi: 144, quality: 0.68 },
  smallest: { dpi: 96, quality: 0.5 },
} satisfies Record<string, Params>

/** One dial from 0 (gentle) to 1 (aggressive), used to search for a size target. */
const paramsAt = (s: number): Params => ({ dpi: Math.round(220 - 180 * s), quality: 0.85 - 0.55 * s })

interface Candidate {
  ref: PDFRef
  key: string
  width: number
  height: number
  originalBytes: number
  kind: 'jpeg' | 'flate'
  components: 1 | 3
  colorSpace: PDFObject | undefined // kept for 3-component images; gray becomes RGB
  predictor: number
}

/**
 * Images claiming more pixels than this are left alone. A tiny PDF can declare an enormous image
 * whose data unpacks to gigabytes (a "decompression bomb"); 40 megapixels still covers an
 * 8,000 × 5,000 scan, far beyond any normal document.
 */
export const MAX_IMAGE_PIXELS = 40_000_000

const N = (s: string) => PDFName.of(s)
const keyOf = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber}`
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined)

export class Compressor<B extends { width: number; height: number }> {
  private candidates: Candidate[] = []
  private maxPagePt = 842
  private decoded = new Map<string, { bitmap: B; pixels: number }>()
  private heldPixels = 0
  private undecodable = new Set<string>()
  private encoded = new Map<string, Uint8Array | null>()
  private heldBytes = 0
  private baseline: Uint8Array | null = null
  private turn: Promise<unknown> = Promise.resolve()

  constructor(
    readonly source: Uint8Array,
    private codec: Codec<B>,
    private budgets: Budgets = DEFAULT_BUDGETS,
  ) {}

  get imageCount() {
    return this.candidates.length
  }

  async init() {
    const doc = await PDFDocument.load(this.source, { updateMetadata: false })
    this.maxPagePt = Math.max(...doc.getPages().map((p) => Math.max(p.getWidth(), p.getHeight())), 1)
    this.candidates = findCandidates(doc)
  }

  /** Frees everything kept in memory. Call when the compressor is no longer needed. */
  dispose() {
    for (const { bitmap } of this.decoded.values()) this.codec.release?.(bitmap)
    this.decoded.clear()
    this.encoded.clear()
    this.heldPixels = this.heldBytes = 0
    this.baseline = null
  }

  /** Jobs take turns. Two at once would double the memory in use, and could free a picture the other still needs. */
  private inTurn<T>(job: () => Promise<T>): Promise<T> {
    const result = this.turn.then(job, job)
    this.turn = result.catch(() => undefined)
    return result
  }

  /** Compress with fixed settings. Never returns something bigger than the input. */
  run(params: Params): Promise<Uint8Array> {
    return this.inTurn(() => this.runNow(params))
  }

  private async runNow(params: Params): Promise<Uint8Array> {
    const doc = await PDFDocument.load(this.source, { updateMetadata: false })
    const capPx = (this.maxPagePt / 72) * params.dpi
    for (const c of this.candidates) {
      const jpeg = await this.encode(doc, c, capPx, params.quality)
      if (!jpeg || jpeg.length > c.originalBytes * 0.9) continue // not worth it
      const scale = Math.min(1, capPx / Math.max(c.width, c.height))
      replaceImage(doc, c, jpeg, Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale)))
    }
    stripMetadata(doc)
    const out = await doc.save({ useObjectStreams: true })
    return out.length < this.source.length ? out : this.source
  }

  /** Smallest acceptable loss of quality that fits under `target` bytes. */
  fitUnder(target: number): Promise<{ bytes: Uint8Array; met: boolean }> {
    return this.inTurn(async () => {
      // A file that already fits is returned exactly as it is: no image gets re-encoded for nothing.
      if (this.source.length <= target) return { bytes: this.source, met: true }
      this.baseline ??= await this.runNow({ dpi: 10_000, quality: 0.92 }) // lossless-ish pass
      if (this.baseline.length <= target) return { bytes: this.baseline, met: true }
      const strongest = await this.runNow(paramsAt(1))
      if (strongest.length > target) return { bytes: strongest, met: false }
      let lo = 0
      let hi = 1
      let best = strongest
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2
        const out = await this.runNow(paramsAt(mid))
        if (out.length <= target) {
          best = out
          hi = mid
        } else lo = mid
      }
      return { bytes: best, met: true }
    })
  }

  /** Reads and decodes a picture from the document being worked on. */
  private async decode(doc: PDFDocument, c: Candidate): Promise<B | null> {
    const stream = doc.context.lookup(c.ref)
    if (!(stream instanceof PDFRawStream)) return null
    if (c.kind === 'jpeg') {
      const bmp = await this.codec.decodeJpeg(stream.contents)
      // A JPEG carrying EXIF rotation decodes turned; PDF viewers ignore EXIF, so leave it alone.
      if (bmp.width === c.width && bmp.height === c.height) return bmp
      this.codec.release?.(bmp)
      return null
    }
    const rowBytes = c.width * c.components
    // Never unpack more than the image claims to need, whatever the data says.
    const expected = (c.predictor >= 10 ? rowBytes + 1 : rowBytes) * c.height
    let samples = inflateAtMost(stream.contents, expected)
    if (c.predictor >= 10) samples = unPng(samples, rowBytes, c.components, c.height)
    if (samples.length < rowBytes * c.height) return null
    const rgba = new Uint8ClampedArray(c.width * c.height * 4)
    for (let i = 0, j = 0; i < c.width * c.height; i++, j += c.components) {
      const r = samples[j]
      rgba[i * 4] = r
      rgba[i * 4 + 1] = c.components === 3 ? samples[j + 1] : r
      rgba[i * 4 + 2] = c.components === 3 ? samples[j + 2] : r
      rgba[i * 4 + 3] = 255
    }
    return this.codec.fromRGBA(rgba, c.width, c.height)
  }

  private async encode(doc: PDFDocument, c: Candidate, capPx: number, quality: number): Promise<Uint8Array | null> {
    const scale = Math.min(1, capPx / Math.max(c.width, c.height))
    const w = Math.max(1, Math.round(c.width * scale))
    const h = Math.max(1, Math.round(c.height * scale))
    const k = `${c.key}|${w}x${h}|${quality.toFixed(3)}`
    const known = this.encoded.get(k)
    if (known !== undefined) {
      this.encoded.delete(k) // the most recently used goes last, so the oldest is dropped first
      this.encoded.set(k, known)
      return known
    }
    if (this.undecodable.has(c.key)) return null

    let bitmap = this.decoded.get(c.key)?.bitmap ?? null
    let free = () => {}
    if (!bitmap) {
      bitmap = await this.decode(doc, c).catch(() => null)
      if (!bitmap) this.undecodable.add(c.key)
      else {
        const pixels = bitmap.width * bitmap.height
        if (this.heldPixels + pixels <= this.budgets.decodedPixels) {
          this.decoded.set(c.key, { bitmap, pixels })
          this.heldPixels += pixels
        } else {
          const spent = bitmap // over budget: freed the moment it has been used
          free = () => this.codec.release?.(spent)
        }
      }
    }
    let jpeg: Uint8Array | null = null
    try {
      if (bitmap) jpeg = await this.codec.encodeJpeg(bitmap, w, h, quality)
    } catch {
      jpeg = null
    } finally {
      free()
    }
    this.remember(k, jpeg)
    return jpeg
  }

  private remember(k: string, jpeg: Uint8Array | null) {
    this.encoded.set(k, jpeg)
    this.heldBytes += jpeg?.length ?? 0
    for (const [oldest, bytes] of this.encoded) {
      if (this.heldBytes <= this.budgets.encodedBytes || oldest === k) break
      this.encoded.delete(oldest)
      this.heldBytes -= bytes?.length ?? 0
    }
  }
}

function findCandidates(doc: PDFDocument): Candidate[] {
  const images: [PDFRef, PDFRawStream][] = []
  const masks = new Set<string>()
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype'))?.toString() !== '/Image') continue
    images.push([ref, obj])
    for (const m of ['SMask', 'Mask']) {
      const r = obj.dict.get(N(m))
      if (r instanceof PDFRef) masks.add(keyOf(r))
    }
  }

  const out: Candidate[] = []
  for (const [ref, stream] of images) {
    const d = stream.dict
    if (masks.has(keyOf(ref))) continue // soft masks must stay lossless
    if (d.get(N('ImageMask'))?.toString() === 'true' || d.has(N('Decode'))) continue
    if (num(d.get(N('BitsPerComponent'))) !== 8) continue
    const width = num(d.get(N('Width')))
    const height = num(d.get(N('Height')))
    if (!width || !height || width * height < 128 * 128 || width * height > MAX_IMAGE_PIXELS || stream.contents.length < 16_000) continue

    // A soft mask with /Matte must keep the exact same dimensions as its image.
    const smask = doc.context.lookup(d.get(N('SMask')))
    if (smask instanceof PDFRawStream && smask.dict.has(N('Matte'))) continue

    const filters = filterNames(d.get(N('Filter')))
    const kind = filters.length === 1 && filters[0] === '/DCTDecode' ? 'jpeg' : filters.length === 1 && filters[0] === '/FlateDecode' ? 'flate' : null
    if (!kind) continue

    const components = componentCount(doc, d.get(N('ColorSpace')))
    if (components !== 1 && components !== 3) continue

    let predictor = 1
    if (kind === 'flate') {
      let parms = doc.context.lookup(d.get(N('DecodeParms')))
      if (parms instanceof PDFArray) parms = doc.context.lookup(parms.get(0))
      if (parms instanceof PDFDict) {
        predictor = num(parms.get(N('Predictor'))) ?? 1
        const bpc = num(parms.get(N('BitsPerComponent'))) ?? 8
        const colors = num(parms.get(N('Colors'))) ?? 1
        // Only "no prediction" (1) and the PNG predictors (10 to 15) are understood. Anything else
        // (TIFF predictor 2, or an invalid value) is left alone rather than decoded on a guess.
        const supported = predictor === 1 || (predictor >= 10 && predictor <= 15 && bpc === 8 && colors === components)
        if (!supported) continue
      }
    }

    out.push({
      ref,
      key: keyOf(ref),
      width,
      height,
      originalBytes: stream.contents.length,
      kind,
      components,
      colorSpace: components === 3 ? d.get(N('ColorSpace')) : undefined,
      predictor,
    })
  }
  return out
}

function filterNames(f: PDFObject | undefined): string[] {
  if (f instanceof PDFName) return [f.toString()]
  if (f instanceof PDFArray) return f.asArray().map((x) => x.toString())
  return []
}

function componentCount(doc: PDFDocument, cs: PDFObject | undefined): number {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs
  if (v instanceof PDFName) return ({ '/DeviceRGB': 3, '/DeviceGray': 1 } as Record<string, number>)[v.toString()] ?? 0
  if (v instanceof PDFArray) {
    const family = v.get(0)?.toString()
    if (family === '/CalRGB') return 3
    if (family === '/CalGray') return 1
    if (family === '/ICCBased') {
      const icc = doc.context.lookup(v.get(1))
      if (icc instanceof PDFRawStream) return num(icc.dict.get(N('N'))) ?? 0
    }
  }
  return 0
}

function replaceImage(doc: PDFDocument, c: Candidate, jpeg: Uint8Array, width: number, height: number) {
  const old = doc.context.lookup(c.ref)
  if (!(old instanceof PDFRawStream)) return
  const dict = doc.context.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: c.colorSpace ?? 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
  })
  for (const k of ['SMask', 'Mask', 'Intent', 'Interpolate', 'OC']) {
    const v = old.dict.get(N(k))
    if (v) dict.set(N(k), v)
  }
  doc.context.assign(c.ref, PDFRawStream.of(dict, jpeg))
}

function stripMetadata(doc: PDFDocument) {
  doc.catalog.delete(N('Metadata'))
  const info = (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict()
  for (const k of ['Author', 'Creator', 'Producer', 'Subject', 'Keywords', 'CreationDate', 'ModDate']) info.delete(N(k))
}

/** Unpack zlib data, but never beyond `limit` bytes, whatever the data says (a decompression bomb defence). */
export function inflateAtMost(data: Uint8Array, limit: number) {
  return unzlibSync(data, { out: new Uint8Array(limit) })
}

/** Reverse PNG row filters (PDF predictors 10–15). */
function unPng(data: Uint8Array, rowBytes: number, bpp: number, rows: number) {
  const out = new Uint8Array(rowBytes * rows)
  let prev = new Uint8Array(rowBytes)
  for (let r = 0; r < rows; r++) {
    const start = r * (rowBytes + 1)
    if (start + rowBytes >= data.length + 1) break
    const type = data[start]
    const row = out.subarray(r * rowBytes, (r + 1) * rowBytes)
    for (let i = 0; i < rowBytes; i++) {
      const x = data[start + 1 + i]
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = x
      if (type === 1) v = x + a
      else if (type === 2) v = x + b
      else if (type === 3) v = x + ((a + b) >> 1)
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      row[i] = v & 0xff
    }
    prev = row
  }
  return out
}
