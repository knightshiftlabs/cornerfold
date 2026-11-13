// Makes the test documents once per run, into test-results/files/ (not committed): real PDFs and images
// from the same generators the unit tests use, plus the locked samples.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { manyPagesPdf, mixedSizesPdf, photoJpeg, scanPdf } from '../helpers/fixtures'
import { lockedPdf } from '../helpers/lockedSamples'

export const FILES = join(process.cwd(), 'test-results', 'files')

/** Four A4 pages; 1 and 3 have lines of text, 2 and 4 are blank. */
async function reportPdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= 4; n++) {
    const page = doc.addPage([595, 842])
    if (n % 2) for (let line = 1; line <= 30; line++) page.drawText(`Page ${n}, line ${line}: some real text on this page.`, { x: 60, y: 800 - line * 22, size: 12, font })
  }
  return doc.save()
}

/** A picture with stripes and, optionally, a see-through hole in the middle. */
function picture(w: number, h: number, hole: boolean) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  for (let x = -h; x < w; x += 24) {
    ctx.fillStyle = `hsl(${(x * 3) % 360} 70% 50%)`
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.lineTo(x + 12, h)
    ctx.lineTo(x + 12 + h, 0)
    ctx.lineTo(x + h, 0)
    ctx.fill()
  }
  if (hole) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

/** A 24-bit BMP, written by hand: no library makes them. */
function bmp(w: number, h: number) {
  const row = Math.ceil((w * 3) / 4) * 4
  const out = Buffer.alloc(54 + row * h)
  out.write('BM', 0)
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(w, 18)
  out.writeInt32LE(h, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(row * h, 34)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([(x * 5) % 256, (y * 3) % 256, 200], 54 + y * row + x * 3)
  return out
}

// The smallest valid GIF: one pixel. Enough to prove the format is read.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')

/** Two pages of photographic content: light enough to compress three ways quickly, real enough to shrink. */
async function smallScanPdf() {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawImage(await doc.embedJpg(await photoJpeg(1200, 1700, i * 40, 95)), { x: 0, y: 0, width: 595, height: 842 })
  return doc.save()
}

export default async function globalSetup() {
  mkdirSync(FILES, { recursive: true })
  const write = (name: string, bytes: Uint8Array | Buffer) => writeFileSync(join(FILES, name), bytes)
  write('report.pdf', await reportPdf())
  write('mixed-sizes.pdf', await mixedSizesPdf())
  write('scan.pdf', await scanPdf(3))
  write('scan-small.pdf', await smallScanPdf())
  write('twelve.pdf', await manyPagesPdf(12))
  write('photo.jpg', await photoJpeg(1200, 900, 3, 90))
  write('photo.webp', await picture(1200, 900, false).encode('webp', 85))
  write('sticker.png', await picture(600, 600, true).encode('png'))
  write('photo.bmp', bmp(240, 180))
  write('dot.gif', GIF)
  write('locked.pdf', lockedPdf('aes256'))
  write('restricted.pdf', lockedPdf('restricted'))
  write('notes.txt', Buffer.from('Not a PDF or an image.'))
  write('damaged.pdf', Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nthis is not a real PDF\n'))
}
