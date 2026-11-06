import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib'
import { zlibSync } from 'fflate'
import { Compressor, PRESETS } from '../src/lib/compress'
import { nodeCodec } from './helpers/canvas'
import { bookmarkedPdf, fixture, scanPdf, textPdf } from './helpers/fixtures'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

describe('compressing a scanned document', () => {
  let source: Uint8Array
  let c: Compressor<Parameters<typeof nodeCodec.encodeJpeg>[0]>
  beforeAll(async () => {
    source = await scanPdf(3)
    c = new Compressor(source, nodeCodec)
    await c.init()
  })

  it('finds the photos but leaves the transparency mask alone', () => {
    expect(c.imageCount).toBe(4) // 3 JPEG scans + 1 PNG; its soft mask must not be lossy-compressed
  })

  it('makes each preset smaller than the last, and all far smaller than the original', async () => {
    const light = (await c.run(PRESETS.light)).length
    const balanced = (await c.run(PRESETS.balanced)).length
    const smallest = (await c.run(PRESETS.smallest)).length
    expect(light).toBeLessThan(source.length * 0.6)
    expect(balanced).toBeLessThan(light)
    expect(smallest).toBeLessThan(balanced)
  })

  it('keeps every page readable and the text intact', async () => {
    const out = await c.run(PRESETS.smallest)
    const doc = await pdfjs.getDocument({ data: out.slice(), isEvalSupported: false, verbosity: 0 }).promise
    expect(doc.numPages).toBe(4)
    const text = await (await doc.getPage(4)).getTextContent()
    expect(text.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Text must stay sharp')
  })

  it('keeps the title, removes the author', async () => {
    const doc = await PDFDocument.load(await c.run(PRESETS.balanced), { updateMetadata: false })
    expect(doc.getTitle()).toBe('Scanned bundle')
    expect(doc.getAuthor()).toBeUndefined()
  })

  it('hits a reachable size target, and admits when one is impossible', async () => {
    const reachable = await c.fitUnder(300 * 1024)
    expect(reachable.met).toBe(true)
    expect(reachable.bytes.length).toBeLessThanOrEqual(300 * 1024)
    const impossible = await c.fitUnder(5 * 1024)
    expect(impossible.met).toBe(false)
    expect(impossible.bytes.length).toBeGreaterThan(5 * 1024)
  })
})

describe('files compression should not touch', () => {
  it('never returns a bigger file than it was given (text-only PDF)', async () => {
    const text = await textPdf()
    const c = new Compressor(text, nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(0)
    expect((await c.run(PRESETS.smallest)).length).toBeLessThanOrEqual(text.length)
  })

  it('skips print-shop CMYK images rather than risk damaging them', async () => {
    const cmyk = fixture('cmyk.pdf')
    const c = new Compressor(cmyk, nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(0)
  })

  it('keeps bookmarks when compressing an untouched PDF', async () => {
    const book = await bookmarkedPdf()
    const c = new Compressor(book, nodeCodec)
    await c.init()
    const out = await PDFDocument.load(await c.run(PRESETS.balanced), { updateMetadata: false })
    expect(out.catalog.has(PDFName.of('Outlines'))).toBe(true)
    expect(out.getTitle()).toBe('Bookmarked book')
    expect(out.getAuthor()).toBeUndefined()
  })
})

describe('size targets on files that already fit (regression)', () => {
  it('returns the original file untouched when it is already under the limit', async () => {
    const src = await scanPdf(3)
    const c = new Compressor(src, nodeCodec)
    await c.init()
    const r = await c.fitUnder(src.length * 2) // a limit far above the file's size
    expect(r.met).toBe(true)
    expect(r.bytes.length).toBe(src.length)
    expect(Buffer.compare(Buffer.from(r.bytes), Buffer.from(src))).toBe(0) // byte for byte, no image re-encoded
  })

  it('still compresses when the file really is over the limit', async () => {
    const src = await scanPdf(3)
    const c = new Compressor(src, nodeCodec)
    await c.init()
    const r = await c.fitUnder(Math.floor(src.length / 4))
    expect(r.bytes.length).toBeLessThan(src.length)
  })
})

/** A PDF whose single image is Flate-encoded with the given predictor in its decode parameters. */
async function imageWithPredictor(predictor: number) {
  const w = 300
  const h = 300
  let seed = 7
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let i = 0; i < raw.length; i++) raw[i] = ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 0xff // noise, so the stream is large
  const d = await PDFDocument.create()
  d.addPage()
  const dict = d.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
    DecodeParms: { Predictor: predictor, Colors: 3, BitsPerComponent: 8, Columns: w },
  })
  d.context.register(PDFRawStream.of(dict, zlibSync(raw)))
  return d.save()
}

describe('image encodings that are not fully understood (regression)', () => {
  it.each([2, 3, 5, 9, 16, 99])('leaves an image with predictor %i alone', async (predictor) => {
    const c = new Compressor(await imageWithPredictor(predictor), nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(0)
  })

  it.each([1, 10, 12, 15])('still considers an image with the supported predictor %i', async (predictor) => {
    const c = new Compressor(await imageWithPredictor(predictor), nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(1)
  })
})
