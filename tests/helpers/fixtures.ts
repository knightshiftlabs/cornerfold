// Test documents, generated on the fly so the repo stays small. Tiny files that need
// special tools to make (encrypted, signed, corrupted) live in tests/fixtures/.
import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName, PDFNumber, StandardFonts, rgb } from '@cantoo/pdf-lib'
import { createCanvas } from '@napi-rs/canvas'

export const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

async function photoJpeg(w: number, h: number, seed = 0, quality = 95) {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = `hsl(${seed},40%,85%)`
  x.fillRect(0, 0, w, h)
  for (let k = 0; k < 2500; k++) {
    x.fillStyle = `hsla(${(seed + k * 13) % 360},50%,${25 + (k % 50)}%,0.35)`
    x.fillRect((k * 7919) % w, (k * 104729) % h, 20 + (k % 70), 8 + (k % 30))
  }
  return c.encode('jpeg', quality)
}

async function label(doc: PDFDocument, page: ReturnType<PDFDocument['addPage']>, text: string) {
  const f = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 40, y: page.getHeight() - 60, size: 20, font: f, color: rgb(0, 0, 0) })
}

/** Scanned-style pages: large JPEGs, plus a PNG with transparency on the last page. */
export async function scanPdf(pages = 3) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([595, 842])
    p.drawImage(await d.embedJpg(await photoJpeg(2400, 3400, i * 50)), { x: 0, y: 0, width: 595, height: 842 })
  }
  const c = createCanvas(1400, 1000)
  const x = c.getContext('2d')
  for (let k = 0; k < 3000; k++) {
    x.fillStyle = `hsl(${(k * 17) % 360},60%,50%)`
    x.fillRect((k * 31) % 1400, (k * 97) % 1000, 30, 30)
  }
  x.clearRect(500, 400, 400, 200) // a transparent hole, so the PNG carries a soft mask
  const p = d.addPage([595, 842])
  p.drawImage(await d.embedPng(await c.encode('png')), { x: 50, y: 300, width: 495, height: 354 })
  await label(d, p, 'Text must stay sharp')
  d.setTitle('Scanned bundle')
  d.setAuthor('Private Person')
  return d.save()
}
export async function textPdf(pages = 5) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.TimesRoman)
  for (let i = 0; i < pages; i++) d.addPage().drawText('Plain text page. '.repeat(30), { x: 40, y: 760, size: 11, font: f, maxWidth: 515 })
  return d.save()
}

export async function formPdf() {
  const d = await PDFDocument.create()
  const p = d.addPage([595, 842])
  const form = d.getForm()
  const t = form.createTextField('name')
  t.setText('Original value')
  t.addToPage(p, { x: 40, y: 650, width: 300, height: 30 })
  const c = form.createCheckBox('agree')
  c.check()
  c.addToPage(p, { x: 40, y: 600, width: 20, height: 20 })
  return d.save()
}

/** Rotation stored once on the page tree rather than on each page, as some scanners do. */
export async function inheritedRotationPdf() {
  const d = await PDFDocument.create()
  for (let i = 0; i < 2; i++) await label(d, d.addPage([595, 842]), `Page ${i + 1}`)
  d.catalog.Pages().set(PDFName.of('Rotate'), PDFNumber.of(90))
  return d.save({ useObjectStreams: false })
}

export async function mixedSizesPdf() {
  const d = await PDFDocument.create()
  for (const size of [[595, 842], [612, 792], [1191, 842], [252, 144]] as [number, number][]) d.addPage(size)
  return d.save()
}

export async function annotatedPdf() {
  const d = await PDFDocument.create()
  const p = d.addPage()
  const link = d.context.register(
    d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 700, 300, 730], A: { S: 'URI', URI: d.context.obj('https://cornerfold.org') } }),
  )
  const note = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: d.context.obj('Note') }))
  p.node.set(PDFName.of('Annots'), d.context.obj([link, note]))
  return d.save()
}

/** Image-heavy PDF with bookmarks, a title and an author. */
export async function bookmarkedPdf() {
  const d = await PDFDocument.create()
  const pages = []
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([595, 842])
    p.drawImage(await d.embedJpg(await photoJpeg(1800, 2400, i * 90, 92)), { x: 0, y: 0, width: 595, height: 842 })
    pages.push(p)
  }
  const items = pages.map((p, i) => d.context.register(d.context.obj({ Title: d.context.obj(`Chapter ${i + 1}`), Dest: [p.ref, PDFName.of('Fit')] })))
  const outline = d.context.register(d.context.obj({ Type: 'Outlines', First: items[0], Last: items[2], Count: 3 }))
  d.catalog.set(PDFName.of('Outlines'), outline)
  d.setTitle('Bookmarked book')
  d.setAuthor('Someone private')
  return d.save()
}

export async function manyPagesPdf(n: number) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= n; i++) d.addPage([595, 842]).drawText(`Page ${i}`, { x: 220, y: 420, size: 40, font: f })
  return d.save()
}

/** A PDF that claims a kind of protection nobody here can open (one that needs a certificate). */
export async function unsupportedProtectionPdf() {
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Adobe.PubSec', SubFilter: 'adbe.pkcs7.s5', V: 4, Length: 128 }))
  return doc.save({ useObjectStreams: false })
}

/** A PDF of `count` pages, each one a different 480 x 640 photo, so every page has an image worth compressing. */
export async function photosPdf(count: number) {
  const d = await PDFDocument.create()
  for (let i = 0; i < count; i++) {
    const p = d.addPage([360, 480])
    p.drawImage(await d.embedJpg(await photoJpeg(480, 640, i * 37, 95)), { x: 0, y: 0, width: 360, height: 480 })
  }
  return d.save()
}
