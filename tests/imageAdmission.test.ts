// Pictures are checked against their own header before anything is decoded.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { installBrowserImageApis } from './helpers/canvas'

vi.mock('../src/lib/pdf', () => ({ EngineError: class extends Error {}, openPdf: async () => ({ numPages: 1 }), releaseSource: () => {} }))
vi.mock('../src/lib/engine', () => ({ getWorker: () => {}, runJob: vi.fn(), unlockInWorker: vi.fn() }))

let ingestFiles: typeof import('../src/lib/ingest').ingestFiles
let useStore: typeof import('../src/lib/store').useStore
let photoSignature: typeof import('../src/lib/signature').photoSignature
let decoded = 0

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
/** The first bytes of a PNG that says it is w by h. Nothing after the header, so it can't be decoded: only the header can be read. */
const hugePng = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0])
const realPng = async () => new Uint8Array(await createCanvas(40, 30).encode('png'))

beforeAll(async () => {
  installBrowserImageApis()
  const g = globalThis as Record<string, unknown>
  g.matchMedia = () => ({ matches: false })
  const original = g.createImageBitmap as (...a: unknown[]) => Promise<unknown>
  // A header with no pixels behind it would crash the Node canvas library outright; a browser just errors.
  g.createImageBitmap = async (src: Blob, ...rest: unknown[]) => {
    decoded++
    if (src.size < 64) throw new Error('cannot decode')
    return original(src, ...rest)
  }
  ;({ ingestFiles } = await import('../src/lib/ingest'))
  ;({ useStore } = await import('../src/lib/store'))
  ;({ photoSignature } = await import('../src/lib/signature'))
})
beforeEach(() => {
  useStore.setState({ sources: {}, pages: [], past: [], future: [], toast: null, busy: null })
  decoded = 0
})

describe('adding pictures', () => {
  it('refuses a picture that claims to be enormous, says why, and never decodes it', async () => {
    await ingestFiles([new File([hugePng(20000, 20000)], 'bomb.png', { type: 'image/png' })])
    expect(decoded).toBe(0)
    expect(useStore.getState().pages).toHaveLength(0)
    expect(useStore.getState().toast?.text).toMatch(/bomb\.png is 400 megapixels, more than Cornerfold can open safely here \(the limit is 150\)/)
  })

  it('still adds the other pictures from the same batch', async () => {
    const ok = await realPng()
    await ingestFiles([new File([hugePng(20000, 20000)], 'bomb.png', { type: 'image/png' }), new File([ok], 'fine.png', { type: 'image/png' })])
    expect(useStore.getState().pages).toHaveLength(1)
    expect(Object.values(useStore.getState().sources)[0].name).toBe('fine')
    expect(useStore.getState().toast?.text).toContain('bomb.png')
  })

  it('adds an ordinary picture as before', async () => {
    await ingestFiles([new File([await realPng()], 'photo.png', { type: 'image/png' })])
    expect(useStore.getState().pages).toHaveLength(1)
    expect(decoded).toBeGreaterThan(0)
  })

  it('a picture just under the limit is let through to the browser to decode', async () => {
    await ingestFiles([new File([hugePng(12000, 12000)], 'big.png', { type: 'image/png' })])
    expect(decoded).toBe(1) // admitted; this stand-in then fails to decode a header with no pixels, which is a different message
    expect(useStore.getState().toast?.text).not.toMatch(/megapixels/)
  })
})

describe('a photo of a signature', () => {
  it('is refused before decoding when it is too many pixels for a signature', async () => {
    await expect(photoSignature(new Blob([hugePng(9000, 9000)], { type: 'image/png' }))).rejects.toThrow(/megapixels/)
    expect(decoded).toBe(0)
  })

  it('is refused before decoding when the file itself is too large', async () => {
    const big = new Blob([new Uint8Array(41 * 1024 * 1024)], { type: 'image/jpeg' })
    await expect(photoSignature(big)).rejects.toThrow(/larger than/)
    expect(decoded).toBe(0)
  })
})
