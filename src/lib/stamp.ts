// Page numbers and watermarks, drawn onto pages as they are seen: on a turned page, "bottom centre" is the
// bottom of the page on screen, and the text reads upright.
import { StandardFonts, degrees, rgb, type PDFDocument, type PDFFont, type PDFPage } from '@cantoo/pdf-lib'
import { labelsFor, seenSize, toPageSpace, turnOf, type NumberOptions, type Stamps, type WatermarkOptions } from './stampText'
import { fitToPaper, trimLeavesEnough, trimmedBox, type Layout } from './layout'

export type { Stamps } from './stampText'

const INK = rgb(0.2, 0.22, 0.26)

function drawNumber(page: PDFPage, font: PDFFont, label: string, o: NumberOptions) {
  const box = page.getCropBox()
  const turn = turnOf(page.getRotation().angle)
  const [w, h] = seenSize(box, turn)
  const width = font.widthOfTextAtSize(label, o.size)
  const margin = Math.max(18, Math.min(w, h) * 0.045)
  const sx = o.position.endsWith('left') ? margin : o.position.endsWith('right') ? w - margin - width : (w - width) / 2
  const sy = o.position.startsWith('bottom') ? margin : h - margin - o.size * 0.72
  const at = toPageSpace(box, turn, sx, sy)
  page.drawText(label, { x: at.x, y: at.y, size: o.size, font, color: INK, rotate: degrees(turn) })
}

function drawWatermark(page: PDFPage, font: PDFFont, o: WatermarkOptions) {
  const box = page.getCropBox()
  const turn = turnOf(page.getRotation().angle)
  const [w, h] = seenSize(box, turn)
  const theta = (o.angle * Math.PI) / 180
  const room = o.angle ? Math.hypot(w, h) * 0.7 : w * 0.8 // across the diagonal, or across the page
  const size = Math.max(8, Math.min(room / font.widthOfTextAtSize(o.text, 1), h * 0.25))
  const width = font.widthOfTextAtSize(o.text, size)
  const cap = size * 0.72
  // Where the text starts, so that its middle is the middle of the page as seen.
  const sx = w / 2 - (Math.cos(theta) * width) / 2 + (Math.sin(theta) * cap) / 2
  const sy = h / 2 - (Math.sin(theta) * width) / 2 - (Math.cos(theta) * cap) / 2
  const at = toPageSpace(box, turn, sx, sy)
  page.drawText(o.text, { x: at.x, y: at.y, size, font, color: rgb(0.45, 0.47, 0.5), opacity: o.opacity, rotate: degrees(turn + o.angle) })
}

/**
 * Trims a page (only what is shown changes: the cut-off parts stay in the file, hidden) or fits it to a paper size
 * (the content and any form fields are scaled, and the page boxes replaced).
 */
function applyLayout(page: PDFPage, layout: Layout, n: number) {
  const box = page.getCropBox()
  const turn = turnOf(page.getRotation().angle)
  if (layout.kind === 'trim') {
    const [w, h] = seenSize(box, turn)
    if (!trimLeavesEnough(w, h, layout.margins)) throw new Error(`The margins would leave almost nothing of page ${n}. Make them smaller.`)
    const b = trimmedBox(box, turn, layout.margins)
    page.setCropBox(b.x, b.y, b.width, b.height)
    return
  }
  const { scale, box: b } = fitToPaper(box, turn, layout.paper)
  page.scaleContent(scale, scale)
  page.scaleAnnotations(scale, scale)
  page.setMediaBox(b.x, b.y, b.width, b.height)
  page.setCropBox(b.x, b.y, b.width, b.height)
  // Boxes for printers, if any, would otherwise still describe the old page.
  page.setBleedBox(b.x, b.y, b.width, b.height)
  page.setTrimBox(b.x, b.y, b.width, b.height)
  page.setArtBox(b.x, b.y, b.width, b.height)
}

export async function applyStamps(doc: PDFDocument, stamps: Stamps) {
  const pages = doc.getPages()
  if (stamps.layout) pages.forEach((page, i) => applyLayout(page, stamps.layout!, i + 1))
  if (!stamps.numbers && !stamps.watermark?.text.trim()) return
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const labels = stamps.numbers ? labelsFor(pages.length, stamps.numbers) : []
  pages.forEach((page, i) => {
    if (stamps.watermark?.text.trim()) drawWatermark(page, font, stamps.watermark)
    if (stamps.numbers && labels[i]) drawNumber(page, font, labels[i]!, stamps.numbers)
  })
}
