// Deciding, before a picture is decoded, whether it is safe to decode. A picture of a few hundred kilobytes can claim
// to be tens of thousands of pixels across, and decoding it takes about four bytes for every pixel it claims, so the
// size is read from the file's own header first. Nothing here decodes anything.

/** The most pixels one picture may have (a 12000 by 12000 photo is 144 million). Beyond this a phone's tab is lost. */
export const MAX_PICTURE_PIXELS = 150_000_000
/** The most pixels being decoded at the same moment, across all the files that are being added together. */
export const DECODE_BUDGET_PIXELS = 200_000_000
/** What a picture whose header can't be read is assumed to weigh while it is being decoded. */
export const UNKNOWN_PICTURE_PIXELS = 30_000_000
/** A photo of a signature is only ever used at 1,600 pixels, so it needs far less than any other picture. */
export const MAX_SIGNATURE_PHOTO_PIXELS = 60_000_000
export const MAX_SIGNATURE_PHOTO_BYTES = 40 * 1024 * 1024

export class ImageTooLargeError extends Error {
  constructor(
    readonly pixels: number,
    readonly limit: number,
  ) {
    super(`A picture of ${Math.round(pixels / 1e6)} megapixels is larger than the ${Math.round(limit / 1e6)} Cornerfold can open safely.`)
  }
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

/** The width and height a picture's own header declares, or null when the format isn't recognised or the header is cut short. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  try {
    if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { width: u32be(b, 16), height: u32be(b, 20) }
    if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') return { width: u16le(b, 6), height: u16le(b, 8) }
    if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: Math.abs(u32le(b, 18) | 0), height: Math.abs(u32le(b, 22) | 0) }
    if (b.length >= 21 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
      const kind = ascii(b, 12, 4)
      if (kind === 'VP8 ' && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
      if (kind === 'VP8L' && b.length >= 25) return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
      if (kind === 'VP8X' && b.length >= 30) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) }
      return null
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]
        if (marker === 0xff) {
          i++
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) i += 2
        else i += 2 + u16be(b, i + 2)
      }
      return null
    }
    if (b.length >= 16 && ascii(b, 4, 4) === 'ftyp') {
      // AVIF and HEIF: the size sits in an "ispe" box. Several may be listed (thumbnails too), so the largest counts.
      let best: { width: number; height: number } | null = null
      const end = Math.min(b.length - 12, 1 << 16)
      for (let i = 8; i < end; i++) {
        if (b[i] === 0x69 && ascii(b, i, 4) === 'ispe') {
          const width = u32be(b, i + 8)
          const height = u32be(b, i + 12)
          if (!best || width * height > best.width * best.height) best = { width, height }
        }
      }
      return best
    }
  } catch {
    /* a cut-off header: unknown */
  }
  return null
}

/** Throws ImageTooLargeError when the header says the picture is bigger than `limit` pixels; returns its pixel count (or null if unknown). */
export function admit(bytes: Uint8Array, limit = MAX_PICTURE_PIXELS): number | null {
  const size = imageSize(bytes)
  if (!size) return null
  const pixels = size.width * size.height
  if (pixels > limit) throw new ImageTooLargeError(pixels, limit)
  return pixels
}

/**
 * Lets pictures be decoded together only while their pixels, added up, stay within a budget, so adding twenty
 * photos at once can't decode three huge ones at the same moment. One picture bigger than the whole budget still
 * goes, alone. Waiting is first come, first served.
 */
export class PixelBudget {
  private inUse = 0
  private waiting: (() => void)[] = []
  constructor(readonly limit = DECODE_BUDGET_PIXELS) {}

  async use<T>(pixels: number, work: () => Promise<T>): Promise<T> {
    const weight = Math.min(pixels, this.limit)
    while (this.inUse > 0 && this.inUse + weight > this.limit) await new Promise<void>((go) => this.waiting.push(go))
    this.inUse += weight
    try {
      return await work()
    } finally {
      this.inUse -= weight
      const next = this.waiting.shift()
      next?.()
    }
  }
}

/** Shared by every place that decodes a picture, so the budget really is for the whole tab. */
export const decodeBudget = new PixelBudget()
