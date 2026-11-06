import { beforeAll, describe, expect, it, vi } from 'vitest'
import { zlibSync } from 'fflate'
import { installBrowserImageApis } from './helpers/canvas'
import { HIDDEN_STRINGS, sampleJpeg } from './helpers/jpegSamples'
import { stripJpegMetadata } from '../src/lib/jpeg'

vi.mock('../src/lib/pdf', () => ({ EngineError: class extends Error {}, openPdf: async () => ({}), releaseSource: () => {} }))
vi.mock('../src/lib/engine', () => ({ getWorker: () => {}, runJob: vi.fn() }))

const posted: { files?: { bytes: Uint8Array }[] }[] = []
let ingestFiles: typeof import('../src/lib/ingest').ingestFiles
let useStore: typeof import('../src/lib/store').useStore
let handler: (e: { data: unknown }) => Promise<void>

beforeAll(async () => {
  installBrowserImageApis()
  const g = globalThis as Record<string, unknown>
  g.matchMedia = () => ({ matches: false })
  g.self = { postMessage: (m: never) => posted.push(m) }
  ;({ ingestFiles } = await import('../src/lib/ingest'))
  ;({ useStore } = await import('../src/lib/store'))
  await import('../src/lib/worker')
  handler = (g.self as { onmessage: typeof handler }).onmessage
})

let jobId = 0
/** Adds a file the way the app does, then writes it into a PDF with the real export engine. */
async function exportAsPdf(bytes: Uint8Array, name: string, type: string) {
  useStore.setState({ sources: {}, pages: [] })
  await ingestFiles([new File([bytes], name, { type })])
  const source = Object.values(useStore.getState().sources)[0]
  await handler({
    data: {
      id: ++jobId, op: 'merge', name: 'out',
      sources: [{ id: source.id, kind: 'image', mime: source.mime, width: source.width, height: source.height, pageCount: 1, bytes: source.bytes }],
      pages: [{ sourceId: source.id, index: 0, rotation: 0 }],
    },
  })
  return { pdf: Buffer.from(posted[posted.length - 1].files![0].bytes), source }
}
const has = (pdf: Buffer, text: string) => pdf.includes(Buffer.from(text, 'latin1'))

/** A tiny valid PNG, with extra chunks (text, EXIF, XMP) added the way cameras and editors do. */
function png(extraChunks: [string, Uint8Array][]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set(new TextEncoder().encode(type)); body.set(data, 4)
    const out = new Uint8Array(12 + data.length); const v = new DataView(out.buffer)
    v.setUint32(0, data.length); out.set(body, 4); v.setUint32(8 + data.length, crc(body))
    return out
  }
  const w = 40, h = 30
  const ihdr = new Uint8Array(13); const iv = new DataView(ihdr.buffer); iv.setUint32(0, w); iv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2
  const raw = new Uint8Array((w * 3 + 1) * h); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) & 255
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extraChunks.map(([t, d]) => chunk(t, d)), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))]
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0
  for (const p of parts) { all.set(p, at); at += p.length }
  return all
}
const text = (s: string) => new TextEncoder().encode(s)

describe('what a photo carries into an exported PDF (regression: the whole original file, GPS included, used to go in)', () => {
  it('a JPEG photo’s hidden details do not reach the PDF', async () => {
    const original = sampleJpeg('everything')
    const { pdf } = await exportAsPdf(original, 'IMG_0001.jpg', 'image/jpeg')
    for (const secret of HIDDEN_STRINGS) expect(has(pdf, secret), `${secret} must not be in the PDF`).toBe(false)
  })

  it('the picture is not re-encoded: the cleaned file goes in unchanged, at its real size', async () => {
    const original = sampleJpeg('everything')
    const { pdf, source } = await exportAsPdf(original, 'IMG_0001.jpg', 'image/jpeg')
    const cleaned = stripJpegMetadata(original)!
    expect(Buffer.compare(Buffer.from(source.bytes), Buffer.from(cleaned))).toBe(0)
    expect(pdf.includes(Buffer.from(cleaned))).toBe(true)
    expect([source.width, source.height]).toEqual([64, 48])
  })

  it('a progressive photo with GPS is cleaned too', async () => {
    const { pdf } = await exportAsPdf(sampleJpeg('progressive'), 'IMG_0002.jpg', 'image/jpeg')
    expect(has(pdf, 'Exif')).toBe(false)
    expect(has(pdf, 'ExampleMake')).toBe(false)
  })

  it('a PNG’s text, EXIF and XMP chunks do not reach the PDF', async () => {
    const file = png([['tEXt', text('Author\0SecretPngAuthor')], ['eXIf', text('ExampleMake ExamplePhone 9')], ['iTXt', text('XML:com.adobe.xmp\0\0\0\0\0SecretPngXmp')]])
    expect(Buffer.from(file).includes('SecretPngAuthor')).toBe(true) // the test is meaningful
    const { pdf } = await exportAsPdf(file, 'screenshot.png', 'image/png')
    for (const secret of ['SecretPngAuthor', 'ExampleMake', 'SecretPngXmp', 'eXIf', 'tEXt']) expect(has(pdf, secret), secret).toBe(false)
  })
})
