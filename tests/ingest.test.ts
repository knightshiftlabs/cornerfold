// Adding files, through the same code the app runs when you drop or pick them.
// pdf.js runs for real (its Node build); only the browser-only bits are stood in for.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { installBrowserImageApis } from './helpers/canvas'
import { fixture, formPdf, textPdf } from './helpers/fixtures'

vi.mock('../src/lib/pdf', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  class EngineError extends Error {}
  return {
    EngineError,
    openPdf: (_id: string, bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise,
    releaseSource: () => {},
  }
})
vi.mock('../src/lib/engine', () => ({ getWorker: () => {}, runJob: vi.fn() }))

let ingestFiles: typeof import('../src/lib/ingest').ingestFiles
let jpegOrientation: typeof import('../src/lib/ingest').jpegOrientation
let useStore: typeof import('../src/lib/store').useStore
const file = (bytes: Uint8Array, name: string, type = 'application/pdf') => new File([bytes], name, { type })
const toast = () => useStore.getState().toast?.text ?? ''
const pageCount = () => useStore.getState().pages.length

beforeAll(async () => {
  installBrowserImageApis()
  ;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })
  ;({ ingestFiles, jpegOrientation } = await import('../src/lib/ingest'))
  ;({ useStore } = await import('../src/lib/store'))
})
beforeEach(() => useStore.setState({ sources: {}, pages: [], past: [], future: [], toast: null, busy: null }))

describe('files that should be added', () => {
  it('adds every page of a valid PDF, with no warning', async () => {
    await ingestFiles([file(await textPdf(3), 'notes.pdf')])
    expect(pageCount()).toBe(3)
    expect(useStore.getState().sources[useStore.getState().pages[0].sourceId].name).toBe('notes')
    expect(toast()).toBe('')
  })

  it('recognises a PDF by its name even when the browser gives no type', async () => {
    await ingestFiles([file(await textPdf(1), 'scan.PDF', '')])
    expect(pageCount()).toBe(1)
  })

  it('adds PNG and JPEG images as one page each, at their real size', async () => {
    const png = new Uint8Array(readFileSync(new URL('./fixtures/not-a-pdf.pdf', import.meta.url))) // a real PNG inside
    await ingestFiles([file(png, 'shot.png', 'image/png'), file(fixture('upright.jpg'), 'photo.jpg', 'image/jpeg')])
    const sources = Object.values(useStore.getState().sources)
    expect(pageCount()).toBe(2)
    expect(sources.map((s) => [s.kind, s.mime, s.width, s.height])).toEqual([
      ['image', 'image/png', 400, 300],
      ['image', 'image/jpeg', 300, 200],
    ])
  })

  it('keeps going when one file of several is bad, and says which', async () => {
    await ingestFiles([file(await textPdf(2), 'good.pdf'), file(fixture('corrupted.pdf'), 'broken.pdf')])
    expect(pageCount()).toBe(2)
    expect(toast()).toMatch(/broken\.pdf.*damaged/)
  })

  it('adds a fillable form without complaint', async () => {
    await ingestFiles([file(await formPdf(), 'form.pdf')])
    expect(pageCount()).toBe(1)
    expect(toast()).toBe('')
  })
})

describe('files that need a warning', () => {
  it('adds a signed PDF but warns that changes will break the signature', async () => {
    await ingestFiles([file(fixture('signed.pdf'), 'contract.pdf')])
    expect(pageCount()).toBe(1)
    expect(toast()).toMatch(/contract\.pdf is digitally signed/)
  })
})

describe('files that must be refused, each with its own explanation', () => {
  it.each([
    ['password.pdf', 'locked.pdf', /needs a password/],
    ['restricted.pdf', 'statement.pdf', /editing restrictions/],
    ['corrupted.pdf', 'broken.pdf', /damaged, or it may not really be a PDF/],
    ['not-a-pdf.pdf', 'fake.pdf', /damaged, or it may not really be a PDF/],
  ])('%s', async (fixtureName, name, message) => {
    await ingestFiles([file(fixture(fixtureName), name)])
    expect(pageCount()).toBe(0)
    expect(toast()).toMatch(new RegExp(name.replace('.', '\\.')))
    expect(toast()).toMatch(message)
  })

  it('an empty file', async () => {
    await ingestFiles([file(new Uint8Array(), 'empty.pdf')])
    expect(pageCount()).toBe(0)
    expect(toast()).toBe('empty.pdf is empty.')
  })

  it('an iPhone photo the browser can’t decode, with a fix', async () => {
    await ingestFiles([file(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'IMG_0001.HEIC', 'image/heic')])
    expect(pageCount()).toBe(0)
    expect(toast()).toMatch(/iPhone photo \(HEIC\).*Most Compatible/)
  })

  it('an image format the browser can’t decode', async () => {
    await ingestFiles([file(new Uint8Array([1, 2, 3, 4]), 'weird.webp', 'image/webp')])
    expect(toast()).toMatch(/image format this browser can’t open/)
  })

  it('files that aren’t PDFs or images at all', async () => {
    await ingestFiles([file(new TextEncoder().encode('hello'), 'notes.txt', 'text/plain')])
    expect(pageCount()).toBe(0)
    expect(toast()).toBe('That file isn’t a PDF or an image.')
    await ingestFiles([file(await textPdf(1), 'ok.pdf'), file(new Uint8Array(3), 'a.docx', 'application/msword')])
    expect(pageCount()).toBe(1)
    expect(toast()).toMatch(/Skipped 1 file/)
  })
})

describe('empty inputs', () => {
  it('does nothing when given no files', async () => {
    await ingestFiles([])
    expect(pageCount()).toBe(0)
    expect(toast()).toBe('')
    expect(useStore.getState().busy).toBeNull()
  })
})

describe('phone photo orientation', () => {
  it('reads the rotation a phone stores in a JPEG, and treats everything else as upright', () => {
    const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    expect(jpegOrientation(buf(fixture('sideways-exif.jpg')))).toBe(6)
    expect(jpegOrientation(buf(fixture('upright.jpg')))).toBe(1)
    expect(jpegOrientation(new ArrayBuffer(0))).toBe(1) // empty
    expect(jpegOrientation(buf(new Uint8Array([0xff, 0xd8, 0xff])))).toBe(1) // truncated header
    expect(jpegOrientation(buf(fixture('signed.pdf')))).toBe(1) // not a JPEG at all
  })
})
