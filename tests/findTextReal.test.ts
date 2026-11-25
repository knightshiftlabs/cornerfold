// Finding words on a real PDF page, and checking the boxes against where the letters really are. The PDF is made
// here with exact font metrics, so the true position of any word is known, and the boxes must cover it.
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { findInPieces, snapToInk, type Piece, type Raster } from '../src/lib/findText'

const W = 700
const H = 800
const SIZE = 14
const LINE = 'Customer: John Smith, account 12345678 and IBAN GB29NWBK60161331926819.'
const fonts = [
  { name: StandardFonts.Helvetica, y: 700 },
  { name: StandardFonts.TimesRoman, y: 600 },
  { name: StandardFonts.Courier, y: 500 },
  { name: StandardFonts.HelveticaBold, y: 400 },
]

const FONT_DATA = resolve('node_modules/pdfjs-dist/standard_fonts') + '/'

/** Where the letters of `term` really are: drawn on their own at their exact place, then found as ink on a picture. */
async function inkSpan(fontName: StandardFonts, y: number, before: string, term: string): Promise<[number, number]> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([W, H])
  const font = await doc.embedFont(fontName)
  page.drawText(term, { x: 50 + font.widthOfTextAtSize(before, SIZE), y, size: SIZE, font })
  const bytes = await doc.save()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, standardFontDataUrl: FONT_DATA }).promise
  const p = await pdf.getPage(1)
  const scale = 4
  const rv = p.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(rv.width), Math.ceil(rv.height))
  const c = canvas.getContext('2d')
  c.fillStyle = '#fff'
  c.fillRect(0, 0, canvas.width, canvas.height)
  await p.render({ canvasContext: c as never, viewport: rv }).promise
  const d = c.getImageData(0, 0, canvas.width, canvas.height).data
  let lo = Infinity
  let hi = -Infinity
  for (let py = 0; py < canvas.height; py++)
    for (let px = 0; px < canvas.width; px++) if (d[(py * canvas.width + px) * 4] < 160) (lo = Math.min(lo, px)), (hi = Math.max(hi, px + 1))
  await pdf.destroy()
  return [lo / scale, hi / scale]
}

async function pieces() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([W, H])
  const metrics = new Map<string, (s: string) => number>()
  for (const f of fonts) {
    const font = await doc.embedFont(f.name)
    page.drawText(LINE, { x: 50, y: f.y, size: SIZE, font })
    metrics.set(f.name, (s) => font.widthOfTextAtSize(s, SIZE))
  }
  const bytes = await doc.save()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, standardFontDataUrl: FONT_DATA }).promise
  const p = await pdf.getPage(1)
  const vp = p.getViewport({ scale: 1 })
  const content = await p.getTextContent()
  const items: Piece[] = content.items
    .filter((i): i is typeof i & { str: string } => 'str' in i)
    .map((i: any) => ({ str: i.str, transform: i.transform, width: i.width, height: i.height, hasEOL: i.hasEOL, family: content.styles[i.fontName]?.fontFamily }))
  const ctx = createCanvas(10, 10).getContext('2d')
  const measure = (str: string, piece: Piece) => {
    // This test machine has no monospace font, and a browser would have one (Courier New is exactly 0.6 em a letter).
    if (/mono|courier/i.test(piece.family ?? '')) return [...str].length * 60
    ctx.font = `100px ${piece.family || 'sans-serif'}`
    return ctx.measureText(str).width
  }
  const toFraction = (x: number, y: number): [number, number] => {
    const [vx, vy] = vp.convertToViewportPoint(x, y)
    return [vx / vp.width, vy / vp.height]
  }
  // The page as a picture, as the app draws it to settle the boxes.
  const rv = p.getViewport({ scale: 2000 / Math.max(vp.width, vp.height) })
  const canvas = createCanvas(Math.ceil(rv.width), Math.ceil(rv.height))
  const c2 = canvas.getContext('2d')
  c2.fillStyle = '#fff'
  c2.fillRect(0, 0, canvas.width, canvas.height)
  await p.render({ canvasContext: c2 as never, viewport: rv }).promise
  const raster: Raster = c2.getImageData(0, 0, canvas.width, canvas.height)
  await pdf.destroy()
  return { items, measure, toFraction, metrics, raster }
}

describe('boxes round words on a real page', () => {
  for (const term of ['John Smith', '12345678', 'account', 'Customer', 'GB29NWBK60161331926819', 'and IBAN']) {
    it(`cover "${term}" on every font, without swallowing its neighbours`, async () => {
      const { items, measure, toFraction, metrics, raster } = await pieces()
      const hits = findInPieces(items, term, {}, measure, toFraction)
      expect(hits).toHaveLength(4) // once on each of the four lines
      for (const f of fonts) {
        const at = LINE.indexOf(term)
        const [left, right] = await inkSpan(f.name, f.y, LINE.slice(0, at), term) // where the letters really are, in points
        const top = H - (f.y + SIZE * 0.75) // the letters' tops, in points from the top of the page
        const bottom = H - (f.y - SIZE * 0.2)
        const hit = hits.find((h) => Math.abs(h.boxes[0].y * H + (h.boxes[0].h * H) / 2 - (H - f.y - SIZE * 0.375)) < SIZE)!
        expect(hit, `a hit on the ${f.name} line`).toBeTruthy()
        // pdf.js may hand a line over in several pieces (Courier here); the match is then several boxes, side by side.
        const boxes = hit.boxes.map((b, i) => snapToInk(b, raster, { left: i === 0 && hit.startsWord ? 'word' : 'letter', right: i === hit.boxes.length - 1 && hit.endsWord ? 'word' : 'letter' }))
        const [bl, br, bt, bb] = [Math.min(...boxes.map((b) => b.x)) * W, Math.max(...boxes.map((b) => b.x + b.w)) * W, Math.min(...boxes.map((b) => b.y)) * H, Math.max(...boxes.map((b) => b.y + b.h)) * H]
        expect(bl, `${f.name}: left edge, box starts ${bl.toFixed(1)} word starts ${left.toFixed(1)}`).toBeLessThanOrEqual(left + 0.05)
        expect(br, `${f.name}: right edge, box ends ${br.toFixed(1)} word ends ${right.toFixed(1)}`).toBeGreaterThanOrEqual(right - 0.05)
        expect(bt).toBeLessThanOrEqual(top)
        expect(bb).toBeGreaterThanOrEqual(bottom)
        // Not so roomy that it covers the next word: no more than a space and a bit either side.
        expect(left - bl).toBeLessThan(SIZE * 1.3)
        expect(br - right).toBeLessThan(SIZE * 1.3)
      }
    })
  }
})
