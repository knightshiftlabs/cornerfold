// Making a signature picture: drawn, typed or from a photo. Each becomes a PNG cropped to the ink, with a
// see-through background, ready to place on a page. Everything happens here in the browser.
import type { MarkImage } from './marks'
import { newId } from './store'

/** Shown wherever a signature is made or placed. */
export const SIGNATURE_NOTE =
  'This puts a picture of your signature on the page. It is not a digital signature with a certificate. That is fine for most everyday forms, but some documents need a certified signature instead, such as Aadhaar eSign or a digital signature certificate in India.'

/** The smallest box around everything darker than paper, with a little margin. Null when there is no ink. */
function inkBounds(data: Uint8ClampedArray, w: number, h: number) {
  let [left, top, right, bottom] = [w, h, -1, -1]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
  if (right < 0) return null
  const pad = Math.round(Math.max(right - left, bottom - top) * 0.04) + 2
  return { x: Math.max(0, left - pad), y: Math.max(0, top - pad), w: Math.min(w, right + pad) - Math.max(0, left - pad), h: Math.min(h, bottom + pad) - Math.max(0, top - pad) }
}

/** Crops a canvas of ink on a see-through background to the ink, as a PNG. Null if nothing was drawn. */
export async function inkToImage(canvas: HTMLCanvasElement): Promise<MarkImage | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const box = inkBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
  if (!box) return null
  const out = document.createElement('canvas')
  out.width = box.w
  out.height = box.h
  out.getContext('2d')!.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/png'))
  return { id: newId(), png: new Uint8Array(await blob.arrayBuffer()), width: box.w, height: box.h }
}

let fontReady: Promise<void> | null = null
/** The handwriting font for typed signatures, loaded the first time it is needed. */
export function loadSignatureFont() {
  fontReady ??= import('@fontsource/caveat/files/caveat-latin-400-normal.woff2?url').then(async ({ default: url }) => {
    const face = new FontFace('Cornerfold Signature', `url(${url})`)
    document.fonts.add(await face.load())
  })
  return fontReady
}

/** A typed name, written in the handwriting font. */
export async function typedSignature(name: string): Promise<MarkImage | null> {
  await loadSignatureFont()
  const size = 120
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `${size}px "Cornerfold Signature"`
  canvas.width = Math.ceil(ctx.measureText(name).width + size)
  canvas.height = Math.ceil(size * 1.6)
  ctx.font = `${size}px "Cornerfold Signature"` // resizing a canvas resets its settings
  ctx.fillStyle = '#0d1a40'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, size / 2, canvas.height / 2)
  return inkToImage(canvas)
}

/**
 * A signature from a photo of it on paper: the paper becomes see-through and the ink stays, in its own colour.
 * The paper's shade is taken from the photo's edges, so off-white and shadowed paper work too.
 */
export async function photoSignature(file: Blob): Promise<MarkImage | null> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const light = (i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
  // The paper: the typical brightness along the edges.
  const edge: number[] = []
  for (let x = 0; x < canvas.width; x += 4) edge.push(light(x * 4), light(((canvas.height - 1) * canvas.width + x) * 4))
  edge.sort((a, b) => a - b)
  const paper = edge[Math.floor(edge.length / 2)] ?? 255
  for (let i = 0; i < d.length; i += 4) {
    const ink = (paper - light(i)) / Math.max(40, paper * 0.5) // 0 = paper, 1 = clearly ink
    d[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (ink - 0.15) / 0.5)))
  }
  ctx.putImageData(img, 0, 0)
  return inkToImage(canvas)
}
