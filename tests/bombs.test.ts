// Deliberately malicious files: they must fail safely, never freeze or exhaust memory.
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib'
import { zlibSync } from 'fflate'
import { Compressor, MAX_IMAGE_PIXELS, PRESETS, inflateAtMost } from '../src/lib/compress'
import { installBrowserImageApis, nodeCodec } from './helpers/canvas'
import { formPdf } from './helpers/fixtures'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`took longer than ${ms} ms`)), ms))])

/** A PDF whose single image claims width × height pixels, carrying `rawBytes` of real (zero) data. */
async function imageBomb(width: number, height: number, rawBytes: number) {
  const d = await PDFDocument.create()
  d.addPage()
  const dict = d.context.obj({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' })
  let data = zlibSync(new Uint8Array(rawBytes), { level: 9 })
  if (data.length < 20_000) data = new Uint8Array([...data, ...new Uint8Array(20_000 - data.length)]) // big enough to be considered
  d.context.register(PDFRawStream.of(dict, data))
  return d.save()
}

describe('decompression bombs in compression (regression)', () => {
  it('ignores images that claim an absurd size', async () => {
    const c = new Compressor(await imageBomb(60_000, 60_000, 4 * 1024 * 1024), nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(0) // 3.6 billion pixels: left alone, never unpacked
    expect(60_000 * 60_000).toBeGreaterThan(MAX_IMAGE_PIXELS)
  })

  it('never unpacks more data than an image claims, even when the stream lies', () => {
    const bomb = zlibSync(new Uint8Array(64 * 1024 * 1024), { level: 9 }) // ~64 KB that unpacks to 64 MB
    expect(inflateAtMost(bomb, 3_000_000).length).toBe(3_000_000)
    expect(inflateAtMost(zlibSync(new Uint8Array(10)), 100).length).toBe(10) // short data stays short
  })

  it('still compresses normally when an image’s data is larger than it claims', async () => {
    const c = new Compressor(await imageBomb(1000, 1000, 64 * 1024 * 1024), nodeCodec)
    await c.init()
    expect(c.imageCount).toBe(1)
    const out = await within(20_000, c.run(PRESETS.balanced))
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
  })
})

describe('structural tricks', () => {
  it('trusts real pages, not a claimed page count of a billion', async () => {
    const d = await PDFDocument.create()
    d.addPage()
    d.catalog.Pages().set(PDFName.of('Count'), PDFNumber.of(1_000_000_000))
    const doc = await pdfjs.getDocument({ data: await d.save({ useObjectStreams: false }), isEvalSupported: false, verbosity: 0 }).promise
    expect(doc.numPages).toBe(1)
  })

  it('survives absurdly deep nesting without hanging', async () => {
    const depth = 20_000
    const nested = '['.repeat(depth) + ']'.repeat(depth)
    const pdf = new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Junk ${nested} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`,
    )
    const opened = await within(10_000, pdfjs.getDocument({ data: pdf, isEvalSupported: false, verbosity: 0 }).promise.then(() => 'opened', () => 'rejected'))
    expect(['opened', 'rejected']).toContain(opened)
    const loaded = await within(10_000, PDFDocument.load(pdf).then(() => 'loaded', () => 'rejected'))
    expect(['loaded', 'rejected']).toContain(loaded)
  })
})

describe('form field loops in the export engine', () => {
  let handler: (e: { data: unknown }) => Promise<void>
  const received: { ok: boolean; files?: { bytes: Uint8Array }[] }[] = []
  beforeAll(async () => {
    installBrowserImageApis()
    ;(globalThis as Record<string, unknown>).self = { postMessage: (m: never) => received.push(m) }
    await import('../src/lib/worker')
    handler = (globalThis as unknown as { self: { onmessage: typeof handler } }).self.onmessage
  })

  it('finishes when a field claims to be its own parent', async () => {
    const d = await PDFDocument.load(await formPdf())
    const widget = d.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0)
    const field = d.context.lookup(widget) as unknown as { set(k: PDFName, v: unknown): void }
    field.set(PDFName.of('Parent'), widget) // a cycle: the field is its own parent
    const bytes = await d.save()
    await within(10_000, handler({ data: { id: 1, op: 'merge', name: 'x', sources: [{ id: 'loop', kind: 'pdf', pageCount: 1, bytes }], pages: [{ sourceId: 'loop', index: 0, rotation: 0 }] } }))
    expect(received[0].ok).toBe(true)
  })
})
