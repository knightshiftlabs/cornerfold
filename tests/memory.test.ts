// How much the compressor keeps in memory. A 24-page scan used to climb past 1 GB and was never let go.
import { describe, expect, it } from 'vitest'
import { Compressor, DEFAULT_BUDGETS, PRESETS, budgetsFor, type Budgets, type Codec } from '../src/lib/compress'
import { nodeCodec } from './helpers/canvas'
import { photosPdf } from './helpers/fixtures'

type Bitmap = Parameters<typeof nodeCodec.encodeJpeg>[0]

/** Wraps the Node codec to count what is alive, and what work is going on, at every moment. */
function watched() {
  const alive = new Set<Bitmap>()
  const stats = { decodes: 0, encodes: 0, peakAlive: 0, encoding: 0, peakEncoding: 0 }
  const born = (bitmap: Bitmap) => {
    stats.decodes++
    alive.add(bitmap)
    stats.peakAlive = Math.max(stats.peakAlive, alive.size)
    return bitmap
  }
  const codec: Codec<Bitmap> = {
    decodeJpeg: async (bytes) => born(await nodeCodec.decodeJpeg(bytes)),
    fromRGBA: async (...args) => born(await nodeCodec.fromRGBA(...args)),
    encodeJpeg: async (...args) => {
      stats.encodes++
      stats.peakEncoding = Math.max(stats.peakEncoding, ++stats.encoding)
      try {
        return await nodeCodec.encodeJpeg(...args)
      } finally {
        stats.encoding--
      }
    },
    release: (bitmap) => void alive.delete(bitmap),
  }
  return { codec, stats, alive: () => alive.size }
}

const PICTURE = 480 * 640 // pixels in one test picture
const room = (pictures: number, encodedBytes = 1e9): Budgets => ({ decodedPixels: pictures * PICTURE, encodedBytes })
async function compressorFor(count: number, budgets: Budgets) {
  const w = watched()
  const c = new Compressor(await photosPdf(count), w.codec, budgets)
  await c.init()
  return { c, ...w }
}
const PRESET_NAMES = ['balanced', 'light', 'smallest'] as const
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

describe('memory used while compressing', () => {
  it('a small document keeps its pictures: each is decoded once, however many presets are tried', async () => {
    const { c, stats, alive } = await compressorFor(6, room(6))
    expect(c.imageCount).toBe(6)
    for (const name of PRESET_NAMES) await c.run(PRESETS[name])
    expect(stats.decodes).toBe(6)
    expect(alive()).toBe(6)
  })

  it('a large document never holds more pictures than the budget allows (regression: all of them were kept)', async () => {
    const { c, stats, alive } = await compressorFor(10, room(3))
    for (const name of PRESET_NAMES) await c.run(PRESETS[name])
    expect(stats.peakAlive).toBeLessThanOrEqual(3 + 1) // the ones kept, plus the one being worked on
    expect(alive()).toBeLessThanOrEqual(3)
  })

  it('with no room at all, each picture is freed the moment it has been used', async () => {
    const { c, stats, alive } = await compressorFor(10, room(0))
    for (const name of PRESET_NAMES) await c.run(PRESETS[name])
    expect(stats.peakAlive).toBe(1)
    expect(alive()).toBe(0)
    expect(stats.decodes).toBe(10 * 3) // the price: pictures are decoded again for each preset
  })

  it('gives byte-for-byte the same result whatever the budget (bounding memory must never change what comes out)', async () => {
    const results: Uint8Array[][] = []
    for (const budgets of [room(0), room(2), room(100)]) {
      const { c } = await compressorFor(4, budgets)
      const outputs: Uint8Array[] = []
      for (const name of PRESET_NAMES) outputs.push(await c.run(PRESETS[name]))
      const target = Math.round(outputs[0].length * 1.05) // makes the size search do real work
      outputs.push((await c.fitUnder(target)).bytes)
      results.push(outputs)
    }
    for (const other of results.slice(1)) other.forEach((bytes, i) => expect(same(bytes, results[0][i]), `output ${i}`).toBe(true))
  })

  it('jobs started together take turns, so the pictures in use are never doubled (regression: they ran at once)', async () => {
    const { c, stats } = await compressorFor(4, room(2))
    const [a, b, search] = await Promise.all([c.run(PRESETS.balanced), c.run(PRESETS.smallest), c.fitUnder(60_000)])
    expect(stats.peakEncoding).toBe(1)
    expect(stats.peakAlive).toBeLessThanOrEqual(2 + 1)
    // and taking turns gives the same answers as running them one after another
    const sequential = await compressorFor(4, room(2))
    expect(same(a, await sequential.c.run(PRESETS.balanced))).toBe(true)
    expect(same(b, await sequential.c.run(PRESETS.smallest))).toBe(true)
    expect(same(search.bytes, (await sequential.c.fitUnder(60_000)).bytes)).toBe(true)
  })

  it('one job failing does not stop the next from running', async () => {
    const { c } = await compressorFor(4, room(4))
    const broken = c.run({ dpi: Number.NaN, quality: 0.5 }).catch(() => 'failed')
    const fine = c.run(PRESETS.balanced)
    await broken
    expect((await fine).length).toBeGreaterThan(0)
  })

  it('dispose gives everything back', async () => {
    const { c, alive } = await compressorFor(6, room(6))
    await c.run(PRESETS.balanced)
    expect(alive()).toBe(6)
    c.dispose()
    expect(alive()).toBe(0)
  })

  it('remembers compressed pictures only up to its budget', async () => {
    const generous = await compressorFor(5, room(5, 1e9))
    await generous.c.run(PRESETS.balanced)
    await generous.c.run(PRESETS.balanced)
    expect(generous.stats.encodes).toBe(5) // the second run reuses what the first made

    const frugal = await compressorFor(5, room(5, 1))
    await frugal.c.run(PRESETS.balanced)
    await frugal.c.run(PRESETS.balanced)
    expect(frugal.stats.encodes).toBe(10) // nothing fits, so everything is made again
  })
})

describe('how much a device is trusted with', () => {
  it('uses the full budget where the browser reports plenty of memory, or nothing at all', () => {
    expect(budgetsFor(8)).toEqual(DEFAULT_BUDGETS)
    expect(budgetsFor(undefined)).toEqual(DEFAULT_BUDGETS) // Safari and Firefox don't say
  })

  it('shrinks it for phones that report little memory', () => {
    expect(budgetsFor(4).decodedPixels).toBeLessThan(DEFAULT_BUDGETS.decodedPixels)
    expect(budgetsFor(2).decodedPixels).toBeLessThan(budgetsFor(4).decodedPixels)
    expect(budgetsFor(0.5).decodedPixels).toBe(budgetsFor(2).decodedPixels)
    // even the smallest budget holds at least one large scan page, so one picture is never decoded twice in a run
    expect(budgetsFor(1).decodedPixels).toBeGreaterThanOrEqual(2480 * 3508)
  })
})
