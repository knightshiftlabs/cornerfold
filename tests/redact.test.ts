// Redaction: pages with boxes are replaced by flattened pictures before anything is exported.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { markContext, drawMarks } from '../src/lib/markDraw'
import type { Mark } from '../src/lib/marks'

const rendered = vi.fn(async (_source: unknown, _index: number, _boxes: unknown[]) => ({ bytes: new Uint8Array([1, 2, 3]), width: 1654, height: 2339 }))
const forgotten: string[][] = []
vi.mock('../src/lib/pdf', () => ({
  pdfPageSize: async () => [595, 842],
  renderRedacted: (...a: Parameters<typeof rendered>) => rendered(...a),
  pageText: vi.fn(async () => 'SECRET'),
  EngineError: class extends Error {},
}))
vi.mock('../src/lib/engine', () => ({ forgetSources: (ids: string[]) => forgotten.push(ids), runJob: vi.fn() }))

let useStore: typeof import('../src/lib/store').useStore
let withRedactions: typeof import('../src/lib/redact').withRedactions
const box = (id = 'b', x = 0.1): Mark => ({ id, kind: 'redact', x, y: 0.1, w: 0.3, h: 0.05 })
const pdfSource = { id: 's', name: 'file', kind: 'pdf' as const, bytes: new Uint8Array(1), pageCount: 3 }
const page = (id: string, index: number, marks?: Mark[], rotation = 0) => ({ id, sourceId: 's', index, rotation, ...(marks ? { marks } : {}) })

beforeEach(async () => {
  vi.resetModules()
  rendered.mockClear()
  forgotten.length = 0
  ;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })
  ;({ useStore } = await import('../src/lib/store'))
  ;({ withRedactions } = await import('../src/lib/redact'))
  useStore.setState({ sources: { s: pdfSource } })
})
afterEach(() => vi.restoreAllMocks())

describe('flattening redacted pages before export', () => {
  it('leaves pages with no redactions exactly as they are, and draws nothing', async () => {
    const pages = [page('a', 0), page('b', 1, [{ id: 't', kind: 'text', x: 0, y: 0, text: 'hi', size: 12 }])]
    const out = await withRedactions(pages)
    expect(out.pages).toBe(pages)
    expect(rendered).not.toHaveBeenCalled()
  })

  it('replaces a redacted page with its picture, the same size in points, and keeps its turn and its other marks', async () => {
    const text: Mark = { id: 't', kind: 'text', x: 0.5, y: 0.5, text: 'Approved', size: 12 }
    const pages = [page('a', 0), page('b', 1, [box(), text], 90), page('c', 2)]
    const out = await withRedactions(pages)
    expect(out.pages[0]).toBe(pages[0])
    expect(out.pages[2]).toBe(pages[2])
    const flat = out.pages[1]
    expect(flat.index).toBe(0)
    expect(flat.rotation).toBe(90)
    expect(flat.marks).toEqual([text]) // the redaction is gone from the marks: it is in the pixels
    const source = out.sources[flat.sourceId]
    expect(source).toMatchObject({ kind: 'image', mime: 'image/jpeg', pageCount: 1, width: 1654, height: 2339, pointSize: [595, 842] })
    expect(rendered).toHaveBeenCalledTimes(1)
    expect(rendered.mock.calls[0][1]).toBe(1) // the page asked for, from the original file
    expect(rendered.mock.calls[0][2]).toEqual([{ x: 0.1, y: 0.1, w: 0.3, h: 0.05 }])
  })

  it('does not change the files in the store: the original pages stay as they were', async () => {
    const out = await withRedactions([page('b', 1, [box()])])
    expect(useStore.getState().sources.s).toBe(pdfSource)
    expect(Object.keys(useStore.getState().sources)).toEqual(['s'])
    expect(Object.keys(out.sources)).toHaveLength(2)
  })

  it('draws each redacted page once for the same boxes, and again when a box changes', async () => {
    await withRedactions([page('b', 1, [box()])])
    await withRedactions([page('b', 1, [box()])])
    expect(rendered).toHaveBeenCalledTimes(1)
    await withRedactions([page('b', 1, [box('b', 0.2)])])
    expect(rendered).toHaveBeenCalledTimes(2)
  })

  it('on a photo, maps the boxes through the paper chosen for photos', async () => {
    useStore.setState({
      sources: { p: { id: 'p', name: 'photo', kind: 'image', mime: 'image/jpeg', bytes: new Uint8Array(1), pageCount: 1, width: 800, height: 600 } },
      paper: { size: 'a4', margin: 'none', orientation: 'auto' },
    })
    const out = await withRedactions([{ id: 'x', sourceId: 'p', index: 0, rotation: 0, marks: [{ id: 'r', kind: 'redact', x: 0, y: 0, w: 1, h: 1 }] }])
    const asked = rendered.mock.calls[0][2] as { x: number; y: number; w: number; h: number }[]
    // A whole-page box covers the whole photo, however the photo sits on the paper.
    expect(asked).toEqual([{ x: 0, y: 0, w: 1, h: 1 }])
    expect(out.sources[out.pages[0].sourceId].pointSize).toBeUndefined() // a photo page follows the paper setting
  })

  it('forgets the oldest pictures in the export engine once there are too many kept', async () => {
    for (let i = 0; i < 18; i++) await withRedactions([page(`p${i}`, 0, [box(`b${i}`, i / 40)])])
    expect(forgotten.flat()).toHaveLength(2)
  })
})

describe('the last line of defence in the export engine', () => {
  it('refuses a redaction that reaches it, rather than drawing a black box over text that is still there', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([200, 200])
    const ctx = markContext(doc, new Map())
    await ctx.ready
    await expect(drawMarks(p, [box()], ctx)).rejects.toThrow(/redaction was not applied/)
  })
})

describe('text extraction', () => {
  it('never reads the text of a redacted page', async () => {
    useStore.setState({ pages: [page('a', 0), page('b', 1, [box()])], selected: new Set() })
    const { collectText } = await import('../src/lib/exporters')
    const { pageText } = await import('../src/lib/pdf')
    const out = await collectText()
    expect(pageText).toHaveBeenCalledTimes(1)
    expect(out.text).toContain('SECRET')
    expect(out.text.match(/SECRET/g)).toHaveLength(1)
  })
})
