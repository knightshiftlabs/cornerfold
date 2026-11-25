// Trimming and fitting pages, as they are seen: every quarter turn, and on a real document.
import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from '@cantoo/pdf-lib'
import { MIN_LEFT, PAPERS, fitToPaper, trimLeavesEnough, trimmedBox } from '../src/lib/layout'
import { applyStamps } from '../src/lib/stamp'

const page = { x: 0, y: 0, width: 600, height: 800 }
const m = { top: 10, right: 20, bottom: 30, left: 40 }
const round = (b: { x: number; y: number; width: number; height: number }) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 100) / 100]))

describe('trimming', () => {
  it('cuts each side as seen, on an upright page', () => {
    expect(trimmedBox(page, 0, m)).toEqual({ x: 40, y: 30, width: 540, height: 760 })
  })

  it('on a page turned a quarter clockwise, the top as seen is the page’s own left side', () => {
    expect(trimmedBox(page, 90, m)).toEqual({ x: 10, y: 40, width: 560, height: 740 })
  })

  it('on a page turned upside down and the other way, every side follows the turn', () => {
    expect(trimmedBox(page, 180, m)).toEqual({ x: 20, y: 10, width: 540, height: 760 })
    expect(trimmedBox(page, 270, m)).toEqual({ x: 30, y: 20, width: 560, height: 740 })
    expect(trimmedBox(page, -90, m)).toEqual(trimmedBox(page, 270, m))
  })

  it('keeps a page box that does not start at zero in place', () => {
    expect(trimmedBox({ x: 100, y: 50, width: 600, height: 800 }, 0, m)).toEqual({ x: 140, y: 80, width: 540, height: 760 })
  })

  it('refuses margins that leave less than half an inch', () => {
    expect(trimLeavesEnough(600, 800, m)).toBe(true)
    expect(trimLeavesEnough(100, 800, { top: 0, bottom: 0, left: 40, right: 100 - 40 - MIN_LEFT })).toBe(true)
    expect(trimLeavesEnough(100, 800, { top: 0, bottom: 0, left: 40, right: 100 - 40 - MIN_LEFT + 1 })).toBe(false)
  })
})

describe('fitting to a paper size', () => {
  it('scales a Letter page onto A4, keeping its shape and centring it', () => {
    const { scale, box } = fitToPaper({ x: 0, y: 0, width: 612, height: 792 }, 0, 'a4')
    expect(scale).toBeCloseTo(595.28 / 612, 5) // limited by the width
    expect(round(box)).toEqual(round({ x: 0, y: (792 * scale - 841.89) / 2, width: 595.28, height: 841.89 }))
  })

  it('keeps a landscape page landscape, whether it is wide itself or turned', () => {
    const wide = fitToPaper({ x: 0, y: 0, width: 800, height: 600 }, 0, 'a4')
    expect([wide.box.width, wide.box.height].map(Math.round)).toEqual([842, 595])
    // Turned a quarter, a tall page is seen wide: the paper is landscape as seen, so portrait in the page's own terms.
    const turned = fitToPaper({ x: 0, y: 0, width: 600, height: 800 }, 90, 'a4')
    expect([turned.box.width, turned.box.height].map(Math.round)).toEqual([595, 842])
  })

  it('enlarges a small page too, and scales a box that does not start at zero with its content', () => {
    const { scale, box } = fitToPaper({ x: 10, y: 20, width: 200, height: 300 }, 0, 'a3')
    expect(scale).toBeCloseTo(Math.min(841.89 / 200, 1190.55 / 300), 5)
    expect(box.x + box.width / 2).toBeCloseTo((10 + 100) * scale, 5)
    expect(box.y + box.height / 2).toBeCloseTo((20 + 150) * scale, 5)
  })
})

describe('on a real document', () => {
  const make = async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792]).setRotation(degrees(90))
    return doc
  }

  it('trimming changes only what is shown: the page itself keeps its full size', async () => {
    const doc = await make()
    await applyStamps(doc, { layout: { kind: 'trim', margins: m } })
    const [a, b] = doc.getPages()
    expect(a.getCropBox()).toEqual(trimmedBox({ x: 0, y: 0, width: 612, height: 792 }, 0, m))
    expect(a.getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 })
    expect(b.getCropBox()).toEqual(trimmedBox({ x: 0, y: 0, width: 612, height: 792 }, 90, m))
  })

  it('says which page is too small for the margins', async () => {
    const doc = await make()
    await expect(applyStamps(doc, { layout: { kind: 'trim', margins: { top: 400, bottom: 400, left: 0, right: 0 } } })).rejects.toThrow('page 1')
  })

  it('fitting replaces every page box with the paper, turned to match', async () => {
    const doc = await make()
    await applyStamps(doc, { layout: { kind: 'fit', paper: 'a4' } })
    const sizes = doc.getPages().map((p) => [p.getMediaBox(), p.getCropBox(), p.getTrimBox()].map((b) => [Math.round(b.width), Math.round(b.height)]))
    expect(sizes[0]).toEqual([[595, 842], [595, 842], [595, 842]])
    expect(sizes[1]).toEqual([[595, 842], [595, 842], [595, 842]]) // seen as landscape: A4 turned with it
    expect(PAPERS.a4.size).toEqual([595.28, 841.89])
  })
})
