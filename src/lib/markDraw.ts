// Drawing Fill and sign marks onto pages, in the export engine. Each mark is placed by where it appears on the
// page, using the same geometry as page numbers, so pages with their own built-in turn are handled too.
import { StandardFonts, degrees, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from '@cantoo/pdf-lib'
import { ASCENT, LINE_HEIGHT, type Mark, type MarkImage } from './marks'
import { seenSize, toPageSpace, turnOf } from './stampText'

const INK = rgb(0.05, 0.1, 0.25) // a dark blue-black, like a pen

export interface MarkContext {
  font: PDFFont
  image: (id: string) => Promise<PDFImage>
}

/** Fonts and pictures for one output document, each embedded once however many pages use it. */
export function markContext(doc: PDFDocument, images: Map<string, MarkImage>): MarkContext & { ready: Promise<void> } {
  let font!: PDFFont
  const embedded = new Map<string, Promise<PDFImage>>()
  return {
    ready: doc.embedFont(StandardFonts.Helvetica).then((f) => void (font = f)),
    get font() {
      return font
    },
    image: (id) => {
      if (!embedded.has(id)) {
        const img = images.get(id)
        if (!img) throw new Error('A signature for this page is missing. Add it again.')
        embedded.set(id, doc.embedPng(img.png))
      }
      return embedded.get(id)!
    },
  }
}

/** Draws a page's marks. Call before any turn added in Cornerfold is applied to the page. */
export async function drawMarks(page: PDFPage, marks: Mark[], ctx: MarkContext) {
  const box = page.getCropBox()
  const turn = turnOf(page.getRotation().angle)
  const [w, h] = seenSize(box, turn)
  // From a fraction measured from the top left as seen, to the page's own coordinates.
  const at = (fx: number, fy: number) => toPageSpace(box, turn, fx * w, h - fy * h)
  for (const m of marks) {
    // Redactions are burned into the page picture before a job is sent (lib/redact.ts). One reaching this point
    // means that step was skipped, and drawing a black box over text that is still in the file would hide nothing.
    if (m.kind === 'redact') throw new Error('A redaction was not applied, so nothing was exported. Please try again.')
    if (m.kind === 'text') {
      m.text.split('\n').forEach((line, i) => {
        if (!line) return
        const p = at(m.x, m.y + ((ASCENT + i * LINE_HEIGHT) * m.size) / h)
        page.drawText(line, { x: p.x, y: p.y, size: m.size, font: ctx.font, color: INK, rotate: degrees(turn) })
      })
    } else if (m.kind === 'image') {
      const p = at(m.x, m.y + m.h) // the picture's bottom left corner, as seen
      page.drawImage(await ctx.image(m.imageId), { x: p.x, y: p.y, width: m.w * w, height: m.h * h, rotate: degrees(turn) })
    } else {
      // A tick or a cross, drawn as lines, so it needs no font and looks the same everywhere.
      const s = m.size
      const pts =
        m.kind === 'tick'
          ? [[[0.1, 0.55], [0.4, 0.85], [0.92, 0.12]]]
          : [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]]
      for (const line of pts) {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = at(m.x + (line[i][0] * s) / w, m.y + (line[i][1] * s) / h)
          const b = at(m.x + (line[i + 1][0] * s) / w, m.y + (line[i + 1][1] * s) / h)
          page.drawLine({ start: a, end: b, thickness: Math.max(1, s * 0.12), color: INK, lineCap: 1 })
        }
      }
    }
  }
}
