import { describe, expect, it } from 'vitest'
import { DECODE_BUDGET_PIXELS, ImageTooLargeError, MAX_PICTURE_PIXELS, PixelBudget, admit, imageSize } from '../src/lib/imageLimits'

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat())

const png = (w: number, h: number) => bytes([0x89, ...text('PNG'), 13, 10, 26, 10], be32(13), text('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0])
const jpeg = (w: number, h: number, withApp = true) =>
  bytes([0xff, 0xd8], withApp ? [0xff, 0xe1, 0, 10, ...new Array(8).fill(0)] : [], [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
const gif = (w: number, h: number) => bytes(text('GIF89a'), le16(w), le16(h), [0, 0, 0])
const bmp = (w: number, h: number) => bytes(text('BM'), new Array(16).fill(0), le32(w), le32(h >>> 0), [1, 0, 24, 0])
const webpX = (w: number, h: number) => bytes(text('RIFF'), le32(40), text('WEBPVP8X'), le32(10), [0, 0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16], [(h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16], [0, 0])
const webpL = (w: number, h: number) => bytes(text('RIFF'), le32(30), text('WEBPVP8L'), le32(10), [0x2f], [(w - 1) & 255, (((w - 1) >> 8) & 0x3f) | (((h - 1) & 3) << 6), ((h - 1) >> 2) & 255, ((h - 1) >> 10) & 15], [0, 0])
const avif = (w: number, h: number) => bytes(be32(20), text('ftypavif'), [0, 0, 0, 0], text('avif'), be32(20), text('ispe'), [0, 0, 0, 0], be32(w), be32(h))

describe('reading a picture’s size from its header, without decoding it', () => {
  it.each([
    ['PNG', png(4000, 3000)],
    ['JPEG', jpeg(4000, 3000)],
    ['JPEG without other segments', jpeg(4000, 3000, false)],
    ['GIF', gif(4000, 3000)],
    ['BMP', bmp(4000, 3000)],
    ['WebP (extended)', webpX(4000, 3000)],
    ['WebP (lossless)', webpL(4000, 3000)],
    ['AVIF', avif(4000, 3000)],
  ])('%s', (_name, file) => {
    expect(imageSize(file)).toEqual({ width: 4000, height: 3000 })
  })

  it('reads a picture that is taller than it is wide, and a bottom-up BMP (whose height is stored negative)', () => {
    expect(imageSize(png(300, 9000))).toEqual({ width: 300, height: 9000 })
    expect(imageSize(bmp(10, -20))).toEqual({ width: 10, height: 20 })
  })

  it('takes the largest size when an AVIF lists several (thumbnails too)', () => {
    const both = bytes(be32(40), text('ftypavif'), new Array(12).fill(0), be32(20), text('ispe'), [0, 0, 0, 0], be32(160), be32(120), be32(20), text('ispe'), [0, 0, 0, 0], be32(8000), be32(6000))
    expect(imageSize(both)).toEqual({ width: 8000, height: 6000 })
  })

  it('says nothing for text, an empty file, or a header that is cut short, instead of guessing', () => {
    expect(imageSize(new Uint8Array())).toBeNull()
    expect(imageSize(bytes(text('hello, this is not a picture at all')))).toBeNull()
    expect(imageSize(png(10, 10).subarray(0, 12))).toBeNull()
    expect(imageSize(jpeg(10, 10).subarray(0, 8))).toBeNull()
  })

  it('does not loop or crash on a damaged JPEG', () => {
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull()
    expect(imageSize(bytes([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeNull()
  })
})

describe('refusing a picture that is too large before decoding it', () => {
  it('lets ordinary pictures through, and says their size', () => {
    expect(admit(jpeg(4000, 3000))).toBe(12_000_000)
    expect(admit(jpeg(12000, 12000))).toBe(144_000_000)
  })

  it('refuses one over the limit, however small the file, because the header is what counts', () => {
    expect(() => admit(png(20000, 20000))).toThrow(ImageTooLargeError)
    expect(png(20000, 20000).length).toBeLessThan(100)
    expect(20000 * 20000).toBeGreaterThan(MAX_PICTURE_PIXELS)
  })

  it('takes a smaller limit for a signature photo', () => {
    expect(() => admit(jpeg(9000, 9000), 60_000_000)).toThrow(/megapixels/)
  })

  it('does not refuse what it cannot read: the browser is left to decide, under the shared budget', () => {
    expect(admit(bytes(text('not a picture')))).toBeNull()
  })
})

describe('decoding pictures together within a pixel budget', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const run = async (budget: PixelBudget, sizes: number[]) => {
    let inUse = 0
    let peak = 0
    await Promise.all(
      sizes.map((px) =>
        budget.use(px, async () => {
          inUse += px
          peak = Math.max(peak, inUse)
          await sleep(10)
          inUse -= px
        }),
      ),
    )
    return peak
  }

  it('never has more than the budget decoding at once', async () => {
    expect(await run(new PixelBudget(100), [40, 40, 40, 40, 40, 40])).toBeLessThanOrEqual(100)
  })

  it('still decodes two small ones at the same time', async () => {
    expect(await run(new PixelBudget(100), [30, 30])).toBe(60)
  })

  it('lets a picture bigger than the whole budget through, on its own, instead of waiting for ever', async () => {
    expect(await run(new PixelBudget(100), [500, 10])).toBeLessThanOrEqual(500)
  })

  it('goes on after a decode fails, so one bad file cannot block the rest', async () => {
    const budget = new PixelBudget(100)
    await expect(budget.use(90, async () => Promise.reject(new Error('bad')))).rejects.toThrow('bad')
    await expect(budget.use(90, async () => 'fine')).resolves.toBe('fine')
  })

  it('serves them in the order they asked', async () => {
    const budget = new PixelBudget(100)
    const order: number[] = []
    await Promise.all([80, 80, 80].map((px, i) => budget.use(px, async () => void (await sleep(5), order.push(i)))))
    expect(order).toEqual([0, 1, 2])
  })

  it('the shared budget is a few hundred million pixels, so three huge photos cannot be decoded together', () => {
    expect(DECODE_BUDGET_PIXELS).toBeLessThan(3 * MAX_PICTURE_PIXELS)
  })
})
