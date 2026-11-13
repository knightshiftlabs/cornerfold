// Reading results back in Node: PDFs with pdf-lib and pdf.js, ZIPs with fflate, image sizes from their headers.
import { PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { unzipSync } from 'fflate'

export const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false })
export const unzip = (bytes: Uint8Array) => unzipSync(bytes)

export async function pageSizes(bytes: Uint8Array) {
  return (await load(bytes)).getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`)
}

export async function rotations(bytes: Uint8Array) {
  return (await load(bytes)).getPages().map((p) => p.getRotation().angle)
}

export async function isEncrypted(bytes: Uint8Array) {
  return !!(await PDFDocument.load(bytes, { ignoreEncryption: true })).context.trailerInfo.Encrypt
}

export async function info(bytes: Uint8Array) {
  const doc = await load(bytes)
  return { title: doc.getTitle(), producer: doc.getProducer(), author: doc.getAuthor(), creator: doc.getCreator(), xmp: !!doc.catalog.get(PDFName.of('Metadata')) }
}

/** Each page's text as it appears on screen: position from the page's top left and angle (0 is upright). */
export async function seenText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const items = (await page.getTextContent()).items.flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return []
      const t = pdfjs.Util.transform(vp.transform, it.transform)
      return [{ str: it.str, x: t[4], y: t[5], width: it.width, angle: Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI) }]
    })
    pages.push({ w: vp.width, h: vp.height, items })
  }
  await doc.destroy()
  return pages
}

/** Pixel size of a JPEG or PNG, from its header. */
export function imageSize(b: Uint8Array): [number, number] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b[0] === 0x89) return [v.getUint32(16), v.getUint32(20)]
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1]
    if (marker === 0xc0 || marker === 0xc2) return [v.getUint16(i + 7), v.getUint16(i + 5)]
    i += 2 + v.getUint16(i + 2)
  }
  throw new Error('not a JPEG or PNG')
}

/** Whether there is ink at each point of a page, as fractions from its top left as it appears. */
export async function inkAt(bytes: Uint8Array, points: [number, number][], pageNumber = 1) {
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
  const page = await doc.getPage(pageNumber)
  const vp = page.getViewport({ scale: 1.5 })
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx as never, viewport: vp }).promise
  await doc.destroy()
  return points.map(([fx, fy]) => {
    // A small patch around the point, so a thin stroke near it counts.
    const d = ctx.getImageData(Math.floor(fx * canvas.width) - 3, Math.floor(fy * canvas.height) - 3, 7, 7).data
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) return true
    return false
  })
}
