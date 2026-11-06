// The export engine, exactly as the app runs it: messages in, files out.
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { unzipSync } from 'fflate'
import { installBrowserImageApis } from './helpers/canvas'
import { annotatedPdf, bookmarkedPdf, formPdf, inheritedRotationPdf, manyPagesPdf, mixedSizesPdf, scanPdf, textPdf } from './helpers/fixtures'

type Msg = { id: number; ok: boolean; files?: { name: string; bytes: Uint8Array }[]; stats?: { original: number; size: number; met: boolean }; error?: string }
const received: Msg[] = []
let handler: (e: { data: unknown }) => Promise<void>

beforeAll(async () => {
  installBrowserImageApis()
  // Like a real browser, transferring a buffer moves it: the sender's copy becomes empty.
  ;(globalThis as Record<string, unknown>).self = {
    postMessage: (m: Msg, transfer: Transferable[] = []) => received.push(structuredClone(m, { transfer })),
  }
  await import('../src/lib/worker')
  handler = (globalThis as unknown as { self: { onmessage: typeof handler } }).self.onmessage
})

let seq = 0
type Src = { id: string; kind: 'pdf'; pageCount: number; bytes: Uint8Array }
const pdf = (bytes: Uint8Array, pageCount: number): Src => ({ id: `s${++seq}`, kind: 'pdf', pageCount, bytes })
const pages = (s: Src, indices = [...Array(s.pageCount).keys()], rotation = 0) => indices.map((index) => ({ sourceId: s.id, index, rotation }))

async function job(op: 'merge' | 'split' | 'compress', p: ReturnType<typeof pages>, sources: Src[], options?: object) {
  received.length = 0
  await handler({ data: { id: ++seq, op, name: 'out', pages: p, sources, options } })
  const m = received[0]
  if (!m.ok) throw new Error(m.error)
  return m
}
const load = (m: Msg) => PDFDocument.load(m.files![0].bytes, { updateMetadata: false })

describe('merge', () => {
  it('keeps the chosen order and adds rotation on top of what pages already have', async () => {
    const s = pdf(await inheritedRotationPdf(), 2)
    const out = await load(await job('merge', [...pages(s, [0]), ...pages(s, [1], 90)], [s]))
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180])
  })

  it('keeps every page’s own size and orientation', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const out = await load(await job('merge', pages(s), [s]))
    expect(out.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[595, 842], [612, 792], [1191, 842], [252, 144]])
  })

  it('keeps links and comments', async () => {
    const s = pdf(await annotatedPdf(), 1)
    const out = await load(await job('merge', pages(s), [s]))
    expect(out.getPage(0).node.Annots()?.size()).toBe(2)
  })

  it('keeps form fields fillable (regression: they used to lose their form)', async () => {
    const form = pdf(await formPdf(), 1)
    const text = pdf(await textPdf(2), 2)
    const out = await load(await job('merge', [...pages(text, [0]), ...pages(form), ...pages(text, [1])], [form, text]))
    const f = out.getForm()
    expect(f.getTextField('name').getText()).toBe('Original value')
    expect(f.getCheckBox('agree').isChecked()).toBe(true)
    f.getTextField('name').setText('Edited')
    expect((await PDFDocument.load(await out.save())).getForm().getTextField('name').getText()).toBe('Edited')
  })

  it('adds no form when no page has fields', async () => {
    const s = pdf(await textPdf(1), 1)
    expect((await load(await job('merge', pages(s), [s]))).catalog.has(PDFName.of('AcroForm'))).toBe(false)
  })

  it('carries no document information into the new file', async () => {
    const s = pdf(await bookmarkedPdf(), 3)
    const out = await load(await job('merge', pages(s), [s]))
    expect([out.getTitle(), out.getAuthor(), out.getProducer(), out.getCreator()]).toEqual([undefined, undefined, undefined, undefined])
    expect(out.catalog.has(PDFName.of('Metadata'))).toBe(false)
  })

  it('handles 1,000 pages quickly', async () => {
    const s = pdf(await manyPagesPdf(1000), 1000)
    const t = Date.now()
    const out = await load(await job('merge', pages(s), [s]))
    expect(out.getPageCount()).toBe(1000)
    expect(Date.now() - t).toBeLessThan(10_000)
  })
})

describe('split', () => {
  it('produces one PDF per page in a zip, named in order', async () => {
    const s = pdf(await textPdf(3), 3)
    const m = await job('split', pages(s), [s])
    expect(m.files![0].name).toBe('out-pages.zip')
    const entries = unzipSync(m.files![0].bytes)
    expect(Object.keys(entries)).toEqual(['out-p01.pdf', 'out-p02.pdf', 'out-p03.pdf'])
    for (const bytes of Object.values(entries)) expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})

describe('compress through the engine', () => {
  it('keeps bookmarks for an untouched PDF, but rebuilds an edited one', async () => {
    const s = pdf(await bookmarkedPdf(), 3)
    const untouched = await load(await job('compress', pages(s), [s], { preset: 'balanced' }))
    expect(untouched.catalog.has(PDFName.of('Outlines'))).toBe(true)
    const reordered = await load(await job('compress', pages(s, [2, 1, 0]), [], { preset: 'balanced' }))
    expect(reordered.catalog.has(PDFName.of('Outlines'))).toBe(false)
    expect(reordered.getPageCount()).toBe(3)
  })

  // Regression: the engine keeps some results for reuse (the original file, the gentlest pass).
  // Sending those to the page used to move them out of the engine, breaking the next request.
  it('can repeat a request whose answer is the untouched original', async () => {
    const s = pdf(await textPdf(2), 2) // nothing to compress, so the answer is the original bytes
    const first = await job('compress', pages(s), [s], { preset: 'smallest' })
    const again = await job('compress', pages(s), [], { preset: 'smallest' })
    expect(again.files![0].bytes.length).toBe(first.files![0].bytes.length)
    expect(again.files![0].bytes.length).toBeGreaterThan(0)
  })

  it('can repeat a generous size target, whose answer is reused', async () => {
    const s = pdf(await scanPdf(1), 2)
    const first = await job('compress', pages(s), [s], { target: 50 * 1024 * 1024 })
    const again = await job('compress', pages(s), [], { target: 50 * 1024 * 1024 })
    expect(again.files![0].bytes.length).toBe(first.files![0].bytes.length)
    expect(again.files![0].bytes.length).toBeGreaterThan(0)
    expect(again.stats!.met).toBe(true)
  })

  it('reports the original size alongside the result', async () => {
    const s = pdf(await scanPdf(1), 2)
    const m = await job('compress', pages(s), [s], { preset: 'smallest' })
    expect(m.stats!.original).toBe(s.bytes.length)
    expect(m.stats!.size).toBeLessThan(m.stats!.original)
  })
})

describe('memory', () => {
  it('forgets files the app has released, and can take them again afterwards', async () => {
    const s = pdf(await textPdf(1), 1)
    await job('merge', pages(s), [s])
    await handler({ data: { op: 'forget', ids: [s.id] } })
    await expect(job('merge', pages(s), [])).rejects.toThrow() // gone from the engine
    expect((await load(await job('merge', pages(s), [s]))).getPageCount()).toBe(1) // re-sent works
  })
})
