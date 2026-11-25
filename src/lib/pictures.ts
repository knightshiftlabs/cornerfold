// Taking out the pictures stored in a PDF: the plain parts, with no browser or PDF library, so tests can run them.
// pdf.ts finds the pictures with pdf.js (which decodes every kind a PDF can hold) and exporters.ts saves them.

/** The pixel layouts pdf.js hands decoded pictures over in (its ImageKind). */
export const Kind = {
  Gray1: 1, // one bit a pixel, rows padded to a whole byte: a set bit is white
  Rgb: 2,
  Rgba: 3,
} as const

/** Pictures smaller than this on either side are left out: they are spacers, dots and rules, not pictures. */
export const MIN_SIDE = 8

export const worthKeeping = (width: number, height: number) => width >= MIN_SIDE && height >= MIN_SIDE

/** Any of pdf.js's layouts as RGBA, ready for a canvas. */
export function toRgba(kind: number, data: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  if (kind === Kind.Rgba) {
    out.set(data.subarray(0, out.length))
    return out
  }
  if (kind === Kind.Rgb) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j]
      out[i * 4 + 1] = data[j + 1]
      out[i * 4 + 2] = data[j + 2]
      out[i * 4 + 3] = 255
    }
    return out
  }
  if (kind === Kind.Gray1) {
    const row = (width + 7) >> 3
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = data[y * row + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0
        const o = (y * width + x) * 4
        out[o] = out[o + 1] = out[o + 2] = v
        out[o + 3] = 255
      }
    }
    return out
  }
  throw new Error(`Unknown picture layout ${kind}`)
}

/** File names for the pictures: the document, the page they were first found on, and a count on that page. */
export function pictureName(base: string, page: number, nth: number, pages: number, ext: string) {
  const width = Math.max(2, String(pages).length)
  return `${base}-page-${String(page).padStart(width, '0')}-picture-${nth}.${ext}`
}
