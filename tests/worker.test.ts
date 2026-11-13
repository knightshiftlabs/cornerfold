// The export engine, exactly as the app runs it: messages in, files out.
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib'
import { unzipSync } from 'fflate'
import { installBrowserImageApis } from './helpers/canvas'
import { createCanvas } from '@napi-rs/canvas'
import { photoJpeg } from './helpers/fixtures'
import { annotatedPdf, bookmarkedPdf, formPdf, inheritedRotationPdf, manyPagesPdf, mixedSizesPdf, photosPdf, scanPdf, textPdf } from './helpers/fixtures'

type Msg = { id: number; ok: boolean; files?: { name: string; bytes: Uint8Array }[]; stats?: { original: number; size: number; met: boolean }; error?: string }
const received: Msg[] = []
let handler: (e: { data: unknown }) => Promise<void>

// Like a real browser, transferring a buffer moves it: the sender's copy becomes empty.
const fakeSelf = { postMessage: (m: Msg, transfer: Transferable[] = []) => received.push(structuredClone(m, { transfer })) }

beforeAll(async () => {
  installBrowserImageApis()
  ;(globalThis as Record<string, unknown>).self = fakeSelf
  await import('../src/lib/worker')
  handler = (globalThis as unknown as { self: { onmessage: typeof handler } }).self.onmessage
})

let seq = 0
type Src = { id: string; kind: 'pdf'; pageCount: number; bytes: Uint8Array }
const pdf = (bytes: Uint8Array, pageCount: number): Src => ({ id: `s${++seq}`, kind: 'pdf', pageCount, bytes })
const pages = (s: Src, indices = [...Array(s.pageCount).keys()], rotation = 0) => indices.map((index) => ({ sourceId: s.id, index, rotation }))

async function job(op: 'merge' | 'split' | 'compress' | 'blank' | 'stamp', p: ReturnType<typeof pages>, sources: Src[], options?: object) {
  received.length = 0
  ;(globalThis as Record<string, unknown>).self = fakeSelf // pdf.js, when a test uses it to read results, replaces the global `self`
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

describe('a compression that fails can be tried again (regression: the failure was remembered)', () => {
  it('works once the files it was missing have arrived', async () => {
    const s = pdf(await scanPdf(1), 1)
    const p = pages(s)
    received.length = 0
    ;(globalThis as Record<string, unknown>).self = fakeSelf
    await handler({ data: { id: ++seq, op: 'compress', name: 'out', pages: p, sources: [], options: { preset: 'balanced' } } }) // the file never arrived
    expect(received[0].ok).toBe(false)
    const again = await job('compress', p, [s], { preset: 'balanced' })
    expect(again.ok).toBe(true)
    expect(again.stats!.size).toBeLessThan(again.stats!.original)
  })
})

describe('merging forms whose fields share names', () => {
  const fieldsOf = async (m: Msg) =>
    (await load(m)).getForm().getFields().map((f) => ({ name: f.getName(), value: f.constructor.name === 'PDFTextField' ? (f as unknown as { getText(): string }).getText() : undefined }))
  const filled = async (text: string) => {
    const d = await PDFDocument.load(await formPdf())
    d.getForm().getTextField('name').setText(text)
    return d.save()
  }

  it('keeps two copies of the same form independent: later fields are numbered, and keep their own values (regression)', async () => {
    const a = pdf(await filled('Alice'), 1)
    const b = pdf(await filled('Bob'), 1)
    const fields = await fieldsOf(await job('merge', [...pages(a), ...pages(b)], [a, b]))
    expect(fields.map((f) => f.name)).toEqual(['name', 'agree', 'name_2', 'agree_2'])
    expect(fields.filter((f) => f.value).map((f) => f.value)).toEqual(['Alice', 'Bob'])
  })

  it('editing one copy then leaves the other alone', async () => {
    const a = pdf(await filled('Alice'), 1)
    const b = pdf(await filled('Bob'), 1)
    const merged = await load(await job('merge', [...pages(a), ...pages(b)], [a, b]))
    merged.getForm().getTextField('name').setText('Changed')
    expect(merged.getForm().getTextField('name_2').getText()).toBe('Bob')
  })

  it('numbers as many copies as there are', async () => {
    const copies = [pdf(await formPdf(), 1), pdf(await formPdf(), 1), pdf(await formPdf(), 1)]
    const fields = await fieldsOf(await job('merge', copies.flatMap((c) => pages(c)), copies))
    expect(fields.map((f) => f.name).filter((n) => n.startsWith('name'))).toEqual(['name', 'name_2', 'name_3'])
  })

  it('leaves forms with different field names exactly as they were', async () => {
    const other = await PDFDocument.create()
    other.getForm().createTextField('email').addToPage(other.addPage([595, 842]), { x: 40, y: 700, width: 200, height: 24 })
    const a = pdf(await formPdf(), 1)
    const b = pdf(await other.save(), 1)
    expect((await fieldsOf(await job('merge', [...pages(a), ...pages(b)], [a, b]))).map((f) => f.name)).toEqual(['name', 'agree', 'email'])
  })

  it('does not rename a field that legitimately appears on several pages', async () => {
    const shared = await PDFDocument.create()
    const field = shared.getForm().createTextField('name')
    field.addToPage(shared.addPage([595, 842]), { x: 40, y: 700, width: 200, height: 24 })
    field.addToPage(shared.addPage([595, 842]), { x: 40, y: 700, width: 200, height: 24 })
    const a = pdf(await shared.save(), 2)
    const b = pdf(await formPdf(), 1)
    const fields = await fieldsOf(await job('merge', [...pages(a), ...pages(b)], [a, b]))
    expect(fields.map((f) => f.name).filter((n) => n.startsWith('name'))).toEqual(['name', 'name_2']) // one field on two pages, then the other form's
  })

  it('numbers names with accents and other scripts correctly', async () => {
    const make = async () => {
      const d = await PDFDocument.create()
      d.getForm().createTextField('Prénom').addToPage(d.addPage([595, 842]), { x: 40, y: 700, width: 200, height: 24 })
      return pdf(await d.save(), 1)
    }
    const [a, b] = [await make(), await make()]
    expect((await fieldsOf(await job('merge', [...pages(a), ...pages(b)], [a, b]))).map((f) => f.name)).toEqual(['Prénom', 'Prénom_2'])
  })
})

describe('a blank page', () => {
  const sizeOf = async (m: Msg) => {
    const { width, height } = (await load(m)).getPage(0).getSize()
    return [Math.round(width), Math.round(height)]
  }

  it('is the same size as the page it will sit next to', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    expect(await sizeOf(await job('blank', pages(s, [2]), [s]))).toEqual([1191, 842])
    expect(await sizeOf(await job('blank', pages(s, [3]), [s]))).toEqual([252, 144])
  })

  it('matches a turned page as it is seen, not as it is stored', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    expect(await sizeOf(await job('blank', pages(s, [0], 90), [s]))).toEqual([842, 595])
    expect(await sizeOf(await job('blank', pages(s, [0], 180), [s]))).toEqual([595, 842])
  })

  it('is A4 when there is no page to match', async () => {
    expect(await sizeOf(await job('blank', [], []))).toEqual([595, 842])
  })

  it('has exactly one page and nothing on it', async () => {
    const out = await load(await job('blank', [], []))
    expect(out.getPageCount()).toBe(1)
    expect(out.getPage(0).node.Contents()).toBeUndefined()
  })
})

describe('splitting into parts', () => {
  const partsOf = async (m: Msg) => {
    const zip = unzipSync(m.files![0].bytes)
    const names = Object.keys(zip).sort()
    const docs = await Promise.all(names.map((n) => PDFDocument.load(zip[n])))
    return { names, zip, sizes: docs.map((d) => d.getPages().map((p) => Math.round(p.getWidth()))), counts: docs.map((d) => d.getPageCount()) }
  }

  it('makes one PDF per group, in order, with the pages of each group in order', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const m = await job('split', pages(s), [s], { groups: [[0, 1, 2], [3]] })
    const parts = await partsOf(m)
    expect(m.files![0].name).toBe('out-parts.zip')
    expect(parts.names).toEqual(['out-part-01.pdf', 'out-part-02.pdf'])
    expect(parts.sizes).toEqual([[595, 612, 1191], [252]])
    expect((m as Msg & { info: unknown }).info).toEqual({ parts: 2, oversize: 0 })
  })

  it('lets groups pick pages in any order, and leave pages out', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const parts = await partsOf(await job('split', pages(s), [s], { groups: [[3, 0], [2]] }))
    expect(parts.sizes).toEqual([[252, 595], [1191]])
  })

  it('still names the files as before when every part is a single page', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const m = await job('split', pages(s), [s])
    expect(m.files![0].name).toBe('out-pages.zip')
    expect((await partsOf(m)).names).toEqual(['out-p01.pdf', 'out-p02.pdf', 'out-p03.pdf', 'out-p04.pdf'])
  })

  it('by size: every part is under the limit, and no page is lost or moved', async () => {
    const s = pdf(await photosPdf(6), 6)
    const single = (await job('merge', pages(s, [0]), [s])).files![0].bytes.length
    const limit = Math.round(single * 2.5) // room for two photos, not three
    const m = await job('split', pages(s), [s], { maxBytes: limit })
    const parts = await partsOf(m)
    for (const name of parts.names) expect(parts.zip[name].length, name).toBeLessThanOrEqual(limit)
    expect(parts.counts.reduce((a, b) => a + b, 0)).toBe(6)
    expect(parts.counts.every((c) => c >= 1 && c <= 2)).toBe(true)
    expect(parts.counts.length).toBeLessThan(6) // it really did put more than one page in a part
    expect((m as Msg & { info: { parts: number; oversize: number } }).info).toEqual({ parts: parts.names.length, oversize: 0 })
  })

  it('by size: a page that is over the limit on its own gets a part to itself, and is counted', async () => {
    const s = pdf(await photosPdf(3), 3)
    const m = await job('split', pages(s), [s], { maxBytes: 2000 })
    expect((await partsOf(m)).counts).toEqual([1, 1, 1])
    expect((m as Msg & { info: { parts: number; oversize: number } }).info).toEqual({ parts: 3, oversize: 3 })
  })
})

describe('photos placed on paper', () => {
  const photoSource = async (w: number, h: number) => {
    const bytes = await photoJpeg(w, h, 5, 90)
    return { id: `img${++seq}`, kind: 'image' as const, mime: 'image/jpeg' as const, width: w, height: h, pageCount: 1, bytes }
  }
  const pageSize = async (m: Msg, i = 0) => {
    const p = (await load(m)).getPage(i)
    return [Math.round(p.getWidth()), Math.round(p.getHeight())]
  }

  it('without a setting, a photo is a page of its own size, as before', async () => {
    const s = await photoSource(800, 600)
    expect(await pageSize(await job('merge', pages(s), [s]))).toEqual([600, 450])
  })

  it('on A4, a landscape photo gets a landscape A4 page', async () => {
    const s = await photoSource(800, 600)
    const m = await job('merge', pages(s), [s], { paper: { size: 'a4', margin: 'small', orientation: 'auto' } })
    expect(await pageSize(m)).toEqual([842, 595])
  })

  it('on Letter in portrait, every photo gets the same page', async () => {
    const [a, b] = [await photoSource(800, 600), await photoSource(600, 800)]
    const m = await job('merge', [...pages(a), ...pages(b)], [a, b], { paper: { size: 'letter', margin: 'none', orientation: 'portrait' } })
    expect([await pageSize(m, 0), await pageSize(m, 1)]).toEqual([[612, 792], [612, 792]])
  })

  it('leaves PDF pages exactly as they were', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const m = await job('merge', pages(s), [s], { paper: { size: 'a4', margin: 'wide', orientation: 'portrait' } })
    expect(await pageSize(m, 2)).toEqual([1191, 842])
  })

  it('applies to splitting and compressing too', async () => {
    const s = await photoSource(800, 600)
    const options = { paper: { size: 'a4', margin: 'small', orientation: 'portrait' } }
    const zip = unzipSync((await job('split', [...pages(s), ...pages(s)], [s], options)).files![0].bytes)
    for (const part of Object.values(zip)) expect((await PDFDocument.load(part)).getPage(0).getWidth()).toBeCloseTo(595.28, 1)
    const compressed = await job('compress', pages(s), [s], { ...options, preset: 'smallest' })
    expect(Math.round((await load(compressed)).getPage(0).getWidth())).toBe(595)
  })

  it('a different paper is a different compression, not a stale answer from before', async () => {
    const s = await photoSource(800, 600)
    const own = await job('compress', pages(s), [s], { preset: 'balanced' })
    const a4 = await job('compress', pages(s), [s], { preset: 'balanced', paper: { size: 'a4', margin: 'small', orientation: 'portrait' } })
    expect(Math.round((await load(own)).getPage(0).getWidth())).toBe(600)
    expect(Math.round((await load(a4)).getPage(0).getWidth())).toBe(595)
  })
})

describe('page numbers and watermarks', () => {
  const NUMBERS = { position: 'bottom-center', format: 'page-n-of-total', start: 1, size: 11, skipFirst: false }
  /** Each page's text as it is seen: position from the top left of the page as shown, and angle (0 is upright). */
  async function seen(m: Msg) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: m.files![0].bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
    const out: { w: number; h: number; items: { str: string; x: number; y: number; width: number; angle: number }[] }[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      const items = (await page.getTextContent()).items.flatMap((it) => {
        if (!('str' in it) || !it.str.trim()) return []
        const t = pdfjs.Util.transform(vp.transform, it.transform)
        return [{ str: it.str, x: t[4], y: t[5], width: it.width, angle: Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI) }]
      })
      out.push({ w: vp.width, h: vp.height, items })
    }
    await doc.destroy()
    return out
  }
  const label = (page: Awaited<ReturnType<typeof seen>>[number], text: string) => page.items.find((i) => i.str === text)

  it('puts the number at the bottom centre of every page, upright, with the total', async () => {
    const s = pdf(await textPdf(3), 3)
    const pagesSeen = await seen(await job('stamp', pages(s), [s], { stamps: { numbers: NUMBERS } }))
    pagesSeen.forEach((p, i) => {
      const n = label(p, `Page ${i + 1} of 3`)!
      expect(n, `page ${i + 1}`).toBeDefined()
      expect(Math.abs(n.x + n.width / 2 - p.w / 2)).toBeLessThan(1.5) // centred
      expect(p.h - n.y).toBeGreaterThan(15) // near the bottom, inside the margin
      expect(p.h - n.y).toBeLessThan(45)
      expect(n.angle).toBe(0)
    })
  })

  it('keeps everything that was on the pages, and only adds the numbers', async () => {
    const s = pdf(await textPdf(3), 3)
    const before = (await seen(await job('merge', pages(s), [s]))).map((p) => p.items.map((i) => i.str))
    const after = (await seen(await job('stamp', pages(s), [s], { stamps: { numbers: NUMBERS } }))).map((p) => p.items.map((i) => i.str))
    after.forEach((strings, i) => {
      expect(before[i].length).toBeGreaterThan(0)
      expect(strings.filter((str) => str !== `Page ${i + 1} of 3`)).toEqual(before[i])
    })
  })

  it.each([90, 180, 270])('on a page turned %i degrees, the number is still at the bottom centre as seen, and upright', async (turn) => {
    const s = pdf(await mixedSizesPdf(), 4)
    const [p] = await seen(await job('stamp', pages(s, [2], turn), [s], { stamps: { numbers: { ...NUMBERS, format: 'n' } } }))
    const n = label(p, '1')!
    expect(n).toBeDefined()
    expect(Math.abs(n.x + n.width / 2 - p.w / 2)).toBeLessThan(1.5)
    expect(p.h - n.y).toBeGreaterThan(15)
    expect(p.h - n.y).toBeLessThan(60)
    expect(n.angle).toBe(0)
  })

  it('handles a turn that is stored on the page tree rather than the page', async () => {
    const s = pdf(await inheritedRotationPdf(), 2)
    const [p] = await seen(await job('stamp', pages(s, [0]), [s], { stamps: { numbers: { ...NUMBERS, format: 'n' } } }))
    const n = label(p, '1')!
    expect(n.angle).toBe(0)
    expect(Math.abs(n.x + n.width / 2 - p.w / 2)).toBeLessThan(1.5)
    expect(p.h - n.y).toBeLessThan(60)
  })

  it.each([
    ['top-right', (p: { w: number; h: number }, n: { x: number; y: number; width: number }) => p.w - (n.x + n.width) < 45 && n.y < 60],
    ['top-left', (p: { w: number; h: number }, n: { x: number; y: number; width: number }) => n.x < 45 && n.y < 60],
    ['bottom-left', (p: { w: number; h: number }, n: { x: number; y: number; width: number }) => n.x < 45 && p.h - n.y < 45],
    ['bottom-right', (p: { w: number; h: number }, n: { x: number; y: number; width: number }) => p.w - (n.x + n.width) < 45 && p.h - n.y < 45],
  ])('places it %s', async (position, where) => {
    const s = pdf(await textPdf(1), 1)
    const [p] = await seen(await job('stamp', pages(s), [s], { stamps: { numbers: { ...NUMBERS, position, format: 'n' } } }))
    expect(where(p, label(p, '1')!)).toBe(true)
  })

  it('leaves the first page unnumbered when asked, and starts from the chosen number', async () => {
    const s = pdf(await textPdf(3), 3)
    const pagesSeen = await seen(await job('stamp', pages(s), [s], { stamps: { numbers: { ...NUMBERS, format: 'n-of-total', start: 5, skipFirst: true } } }))
    expect(pagesSeen[0].items.some((i) => i.str.includes(' / '))).toBe(false)
    expect(label(pagesSeen[1], '5 / 6')).toBeDefined()
    expect(label(pagesSeen[2], '6 / 6')).toBeDefined()
  })

  it('draws a see-through watermark across the middle of each page, at 45 degrees as seen', async () => {
    const s = pdf(await textPdf(2), 2)
    const m = await job('stamp', pages(s), [s], { stamps: { watermark: { text: 'CONFIDENTIAL', angle: 45, opacity: 0.2 } } })
    for (const p of await seen(m)) {
      const w = label(p, 'CONFIDENTIAL')!
      expect(w.angle).toBe(-45) // counter-clockwise as seen; screen y points down
      const midX = w.x + (Math.cos(Math.PI / 4) * w.width) / 2
      const midY = w.y - (Math.sin(Math.PI / 4) * w.width) / 2
      expect(Math.abs(midX - p.w / 2)).toBeLessThan(30)
      expect(Math.abs(midY - p.h / 2)).toBeLessThan(30)
    }
    const page = (await load(m)).getPage(0)
    const states = page.node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict)
    const alphas = states.keys().map((k) => Number(String((states.lookup(k, PDFDict) as PDFDict).get(PDFName.of('ca')))))
    expect(alphas).toContain(0.2)
  })

  it('a straight watermark on a turned page is level and centred as seen', async () => {
    const s = pdf(await mixedSizesPdf(), 4)
    const [p] = await seen(await job('stamp', pages(s, [0], 90), [s], { stamps: { watermark: { text: 'DRAFT', angle: 0, opacity: 0.3 } } }))
    const w = label(p, 'DRAFT')!
    expect(w.angle).toBe(0)
    expect(Math.abs(w.x + w.width / 2 - p.w / 2)).toBeLessThan(2)
  })

  it('numbers and a watermark together', async () => {
    const s = pdf(await textPdf(2), 2)
    const [first] = await seen(await job('stamp', pages(s), [s], { stamps: { numbers: NUMBERS, watermark: { text: 'COPY', angle: 45, opacity: 0.15 } } }))
    expect(label(first, 'Page 1 of 2')).toBeDefined()
    expect(label(first, 'COPY')).toBeDefined()
  })

  it('works on photos placed on paper', async () => {
    const bytes = await photoJpeg(800, 600, 2, 90)
    const photo = { id: `img${++seq}`, kind: 'image' as const, mime: 'image/jpeg' as const, width: 800, height: 600, pageCount: 1, bytes }
    const [p] = await seen(await job('stamp', pages(photo), [photo], { paper: { size: 'a4', margin: 'small', orientation: 'portrait' }, stamps: { numbers: { ...NUMBERS, format: 'n' } } }))
    expect(Math.round(p.w)).toBe(595)
    expect(label(p, '1')).toBeDefined()
  })
})

describe('Fill and sign: marks on pages', () => {
  const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs')
  /** Each page's text as it appears: position from the top left of the page as shown, and angle (0 is upright). */
  async function seenItems(m: Msg) {
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: m.files![0].bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
    const out = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      const items = (await page.getTextContent()).items.flatMap((it) => {
        if (!('str' in it) || !it.str.trim()) return []
        const t = lib.Util.transform(vp.transform, it.transform)
        return [{ str: it.str, x: t[4], y: t[5], angle: Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI) }]
      })
      out.push({ w: vp.width, h: vp.height, items })
    }
    await doc.destroy()
    return out
  }
  /** The first page drawn to pixels, as it appears. `dark(fx, fy)` says whether there is ink at that point. */
  async function rendered(m: Msg) {
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: m.files![0].bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as never, viewport: vp }).promise
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    await doc.destroy()
    return {
      w: canvas.width,
      h: canvas.height,
      dark: (fx: number, fy: number) => {
        const i = (Math.floor(fy * canvas.height) * canvas.width + Math.floor(fx * canvas.width)) * 4
        return px[i] + px[i + 1] + px[i + 2] < 200
      },
    }
  }
  const blank = async (size: [number, number] = [595, 842]) => {
    const d = await PDFDocument.create()
    d.addPage(size)
    return pdf(await d.save(), 1)
  }
  const blackSquare = async () => ({ id: 'sig-1', png: new Uint8Array(await (() => { const c = createCanvas(40, 20); const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 40, 20); return c.encode('png') })()), width: 40, height: 20 })
  const withMarks = (s: Src, marks: object[], rotation = 0) => [{ ...pages(s, [0], rotation)[0], marks }]

  it('puts text where it was placed, upright, measured from the top left', async () => {
    const s = await blank()
    const [p] = await seenItems(await job('merge', withMarks(s, [{ id: 't', kind: 'text', x: 0.1, y: 0.1, text: 'Asha Rao', size: 12 }]), [s]))
    const t = p.items.find((i) => i.str === 'Asha Rao')!
    expect(t.angle).toBe(0)
    expect(t.x).toBeCloseTo(0.1 * p.w, 0)
    expect(t.y).toBeCloseTo(0.1 * p.h + 0.8 * 12, 0) // the baseline, just below the top of the text
  })

  it('writes several lines, each lower than the last', async () => {
    const s = await blank()
    const [p] = await seenItems(await job('merge', withMarks(s, [{ id: 't', kind: 'text', x: 0.1, y: 0.1, text: 'Line one\nLine two', size: 10 }]), [s]))
    const [a, b] = ['Line one', 'Line two'].map((str) => p.items.find((i) => i.str === str)!)
    expect(b.y - a.y).toBeCloseTo(12.5, 0)
    expect(b.x).toBeCloseTo(a.x, 0)
  })

  it('on a page with its own built-in turn, text sits where it was placed as seen, upright', async () => {
    const s = pdf(await inheritedRotationPdf(), 2)
    const [p] = await seenItems(await job('merge', withMarks(s, [{ id: 't', kind: 'text', x: 0.5, y: 0.05, text: 'Signed', size: 12 }]), [s]))
    const t = p.items.find((i) => i.str === 'Signed')!
    expect(t.angle).toBe(0)
    expect(t.x / p.w).toBeCloseTo(0.5, 2)
    expect(t.y / p.h).toBeLessThan(0.1)
  })

  it('a page turned in Cornerfold afterwards turns its marks with it, like ink on paper', async () => {
    const s = await blank()
    const [p] = await seenItems(await job('merge', withMarks(s, [{ id: 't', kind: 'text', x: 0.1, y: 0.1, text: 'Asha Rao', size: 12 }], 90), [s]))
    const t = p.items.find((i) => i.str === 'Asha Rao')!
    expect(t.angle).toBe(90) // turned a quarter clockwise with the page
    expect(t.x / p.w).toBeGreaterThan(0.8) // the top left corner of the page is now its top right
    expect(t.y / p.h).toBeLessThan(0.2)
  })

  it('draws a signature exactly over the box it was placed in, and nowhere else', async () => {
    const s = await blank()
    const img = await blackSquare()
    const r = await rendered(await job('merge', withMarks(s, [{ id: 'i', kind: 'image', x: 0.5, y: 0.6, w: 0.3, h: 0.1, imageId: 'sig-1' }]), [s], { images: [img] }))
    expect(r.dark(0.65, 0.65)).toBe(true) // the middle of the box
    expect(r.dark(0.51, 0.61)).toBe(true) // just inside its top left corner
    expect(r.dark(0.79, 0.69)).toBe(true) // just inside its bottom right corner
    expect(r.dark(0.48, 0.65)).toBe(false) // just outside, left
    expect(r.dark(0.65, 0.72)).toBe(false) // just outside, below
    expect(r.dark(0.2, 0.2)).toBe(false)
  })

  it('a signature on a page with its own built-in turn lands where it was placed as seen', async () => {
    const s = pdf(await inheritedRotationPdf(), 2)
    const r = await rendered(await job('merge', withMarks(s, [{ id: 'i', kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.1, imageId: 'sig-1' }]), [s], { images: [await blackSquare()] }))
    expect(r.dark(0.2, 0.15)).toBe(true)
    expect(r.dark(0.8, 0.85)).toBe(false)
  })

  it('draws a tick and a cross as lines, with no font needed', async () => {
    const s = await blank()
    const r = await rendered(await job('merge', withMarks(s, [{ id: 'a', kind: 'tick', x: 0.2, y: 0.2, size: 40 }, { id: 'b', kind: 'cross', x: 0.6, y: 0.6, size: 40 }]), [s]))
    // The tick's lowest point, and the middle of the cross, where its two strokes meet.
    expect(r.dark(0.2 + (0.4 * 40) / 595, 0.2 + (0.85 * 40) / 842 - 0.003)).toBe(true)
    expect(r.dark(0.6 + 20 / 595, 0.6 + 20 / 842)).toBe(true)
    expect(r.dark(0.4, 0.4)).toBe(false)
  })

  it('says plainly when a signature a page uses is missing, instead of making a broken file', async () => {
    const s = await blank()
    await expect(job('merge', withMarks(s, [{ id: 'i', kind: 'image', x: 0, y: 0, w: 0.1, h: 0.1, imageId: 'never-sent' }]), [s])).rejects.toThrow(/signature .* missing/i)
  })

  it('compressing keeps the marks, even for a file that would otherwise be compressed untouched', async () => {
    const s = pdf(await textPdf(1), 1)
    const plain = await job('compress', pages(s), [s], { preset: 'balanced' })
    const marked = await job('compress', withMarks(s, [{ id: 't', kind: 'text', x: 0.1, y: 0.9, text: 'Approved', size: 14 }]), [s], { preset: 'balanced' })
    expect((await seenItems(plain))[0].items.some((i) => i.str === 'Approved')).toBe(false)
    expect((await seenItems(marked))[0].items.some((i) => i.str === 'Approved')).toBe(true) // not a stale copy of the first
  })
})

describe('Fill and sign: form answers', () => {
  /** A form with every kind of field. */
  async function fullForm() {
    const d = await PDFDocument.create()
    const p = d.addPage([595, 842])
    const form = d.getForm()
    form.createTextField('applicant.name').addToPage(p, { x: 40, y: 760, width: 300, height: 24 })
    form.createCheckBox('agree').addToPage(p, { x: 40, y: 720, width: 18, height: 18 })
    const radio = form.createRadioGroup('plan')
    radio.addOptionToPage('basic', p, { x: 40, y: 680, width: 16, height: 16 })
    radio.addOptionToPage('premium', p, { x: 80, y: 680, width: 16, height: 16 })
    const city = form.createDropdown('city')
    city.addOptions(['Bengaluru', 'Delhi', 'Mumbai'])
    city.addToPage(p, { x: 40, y: 630, width: 160, height: 24 })
    return pdf(await d.save(), 1)
  }
  const answers = { 'applicant.name': 'Asha Rao', agree: true, plan: 'premium', city: 'Delhi' }

  it('fills every kind of field, and the answers stay editable', async () => {
    const s = await fullForm()
    const form = (await load(await job('merge', pages(s), [s], { fields: { [s.id]: answers } }))).getForm()
    expect(form.getTextField('applicant.name').getText()).toBe('Asha Rao')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(form.getRadioGroup('plan').getSelected()).toBe('premium')
    expect(form.getDropdown('city').getSelected()).toEqual(['Delhi'])
  })

  it('locking the answers turns them into page content: the form is gone, the answers are not', async () => {
    const s = await fullForm()
    const m = await job('merge', pages(s), [s], { fields: { [s.id]: answers }, flatten: true })
    expect((await load(m)).getForm().getFields()).toHaveLength(0)
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await lib.getDocument({ data: m.files![0].bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    await doc.destroy()
    expect(text).toContain('Asha Rao')
    expect(text).toContain('Delhi')
  })

  it('what a viewer shows is the new answer, not the old one (regression: a filled copy kept its old look)', async () => {
    const s = pdf(await formPdf(), 1)
    const form = (await load(await job('merge', pages(s), [s], { fields: { [s.id]: { name: 'Asha Rao' } } }))).getForm()
    const widget = form.getTextField('name').acroField.getWidgets()[0]
    const shown = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream
    // Text in an appearance is written either as (letters) or as <hex codes>; read both.
    const raw = new TextDecoder('latin1').decode(decodePDFRawStream(shown).decode())
    const drawn = raw.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'))
    expect(drawn).toContain('Asha Rao')
    expect(drawn).not.toContain('Original value')
  })

  it('unticks a box, and leaves fields that weren’t answered as they were', async () => {
    const s = pdf(await formPdf(), 1)
    const form = (await load(await job('merge', pages(s), [s], { fields: { [s.id]: { agree: false } } }))).getForm()
    expect(form.getCheckBox('agree').isChecked()).toBe(false)
    expect(form.getTextField('name').getText()).toBe('Original value')
  })

  it('answers change only the copy being exported: the next export without them is unchanged', async () => {
    const s = pdf(await formPdf(), 1)
    await job('merge', pages(s), [s], { fields: { [s.id]: { name: 'Changed' } } })
    const form = (await load(await job('merge', pages(s), [s]))).getForm()
    expect(form.getTextField('name').getText()).toBe('Original value')
  })

  it('a changed answer is never served from an earlier compression of the same pages', async () => {
    const s = pdf(await formPdf(), 1)
    const first = await job('compress', pages(s), [s], { preset: 'light', fields: { [s.id]: { name: 'First' } } })
    const second = await job('compress', pages(s), [s], { preset: 'light', fields: { [s.id]: { name: 'Second' } } })
    expect((await load(first)).getForm().getTextField('name').getText()).toBe('First')
    expect((await load(second)).getForm().getTextField('name').getText()).toBe('Second')
  })

  it('a radio option can be chosen by its position too, as pdf.js reports it for some forms', async () => {
    const s = await fullForm()
    const form = (await load(await job('merge', pages(s), [s], { fields: { [s.id]: { plan: '1' } } }))).getForm()
    expect(form.getRadioGroup('plan').getSelected()).toBe('premium')
  })

  it('ignores answers for fields the file doesn’t have', async () => {
    const s = pdf(await formPdf(), 1)
    const m = await job('merge', pages(s), [s], { fields: { [s.id]: { 'no such field': 'x' } } })
    expect(m.ok).toBe(true)
  })
})
