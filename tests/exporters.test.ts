// Saving pages as images or text, and exporting with page numbers or a watermark.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'

const runJob = vi.fn()
const download = vi.fn()
const renderPageImage = vi.fn()
const pageText = vi.fn()
const pagePictures = vi.fn()
const protectPdf = vi.fn()
vi.mock('../src/lib/protect', () => ({ protectPdf: (...a: unknown[]) => protectPdf(...a) }))
vi.mock('../src/lib/engine', () => ({ runJob: (...a: unknown[]) => runJob(...a), getWorker: () => {} }))
vi.mock('../src/lib/pdf', () => ({ renderPageImage: (...a: unknown[]) => renderPageImage(...a), pageText: (...a: unknown[]) => pageText(...a), pagePictures: (...a: unknown[]) => pagePictures(...a), openPdf: vi.fn(), getThumb: vi.fn(), EngineError: class extends Error {}, releaseSource: () => {} }))
vi.mock('../src/lib/actions', async (original) => ({ ...(await original<typeof import('../src/lib/actions')>()), download: (...a: unknown[]) => download(...a) }))
;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })

const { collectText, exportProtected, exportStamped, saveImages, savePictures } = await import('../src/lib/exporters')
const { useStore } = await import('../src/lib/store')

const pagesOf = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, sourceId: 'a', index, rotation: index === 1 ? 90 : 0 }))
const toast = () => useStore.getState().toast

beforeEach(() => {
  for (const f of [runJob, download, renderPageImage, pageText, pagePictures, protectPdf]) f.mockReset()
  renderPageImage.mockImplementation(async (_s, index) => new Uint8Array([index, 1, 2]))
  useStore.setState({ sources: { a: { id: 'a', name: 'report', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 3 } }, pages: pagesOf(3), selected: new Set(), toast: null, busy: null })
})

describe('saving as images', () => {
  it('several pages become one ZIP, named in page order, at the detail chosen, with each page’s turn', async () => {
    await saveImages('jpg', 150)
    expect(renderPageImage.mock.calls.map((c) => c.slice(1))).toEqual([
      [0, 0, 150, 'image/jpeg'],
      [1, 90, 150, 'image/jpeg'],
      [2, 0, 150, 'image/jpeg'],
    ])
    const [bytes, name, type] = download.mock.calls[0]
    expect([name, type]).toEqual(['report-images.zip', 'application/zip'])
    expect(Object.keys(unzipSync(bytes))).toEqual(['report-page-01.jpg', 'report-page-02.jpg', 'report-page-03.jpg'])
    expect(toast()?.text).toBe('Saved 3 images as report-images.zip')
    expect(useStore.getState().busy).toBeNull()
  })

  it('one page is saved as the image itself, not a ZIP', async () => {
    useStore.getState().selectOnly(['p3'])
    await saveImages('png', 300)
    expect(download).toHaveBeenCalledWith(new Uint8Array([2, 1, 2]), 'report-page-01.png', 'image/png')
    expect(toast()?.text).toBe('Saved report-page-01.png')
  })

  it('says so if a page can’t be drawn, and saves nothing half-finished', async () => {
    renderPageImage.mockImplementation(async (_s, index) => {
      if (index === 1) throw new Error('out of memory')
      return new Uint8Array(1)
    })
    await saveImages('jpg', 300)
    expect(download).not.toHaveBeenCalled()
    expect(toast()).toMatchObject({ tone: 'error', text: 'Couldn’t save the images: out of memory' })
    expect(useStore.getState().busy).toBeNull()
  })
})

describe('extracting text', () => {
  it('reads every page in order and counts the ones without text', async () => {
    pageText.mockImplementation(async (_s, index) => (index === 1 ? '' : `Text of ${index + 1}`))
    const r = await collectText()
    expect(r.text).toContain('--- Page 1 ---\n\nText of 1')
    expect(r.text).toContain('--- Page 2 ---\n\n(No text on this page.)')
    expect([r.withText, r.without, r.total, r.name]).toEqual([2, 1, 3, 'report.txt'])
  })

  it('reads only the selected pages when some are selected, numbered as they will be', async () => {
    pageText.mockImplementation(async (_s, index) => `Text of ${index + 1}`)
    useStore.getState().selectOnly(['p3'])
    expect((await collectText()).text).toBe('--- Page 1 ---\n\nText of 3\n')
  })

  it('a page that can’t be read is reported as unreadable, not as a page with no text, and does not stop the others', async () => {
    pageText.mockImplementation(async (_s, index) => {
      if (index === 0) throw new Error('broken')
      return index === 1 ? '' : 'ok'
    })
    const r = await collectText()
    expect(r.failed).toEqual([1])
    expect([r.withText, r.without]).toEqual([1, 1])
    expect(r.text).toContain('--- Page 1 ---\n\n(This page could not be read.)')
    expect(r.text).toContain('--- Page 2 ---\n\n(No text on this page.)')
    expect(r.text).toContain('--- Page 3 ---\n\nok')
  })
})

describe('exporting with stamps', () => {
  beforeEach(() => runJob.mockImplementation(async (_op, _p, name) => ({ files: [{ name, bytes: new Uint8Array(3) }] })))

  it('page numbers: asks the engine to stamp the pages, and names the file to say so', async () => {
    const numbers = { position: 'bottom-center', format: 'n', start: 1, size: 11, skipFirst: false } as const
    await exportStamped({ numbers })
    expect(runJob).toHaveBeenCalledWith('stamp', useStore.getState().pages, 'report-numbered.pdf', { stamps: { numbers } })
    expect(download).toHaveBeenCalledWith(expect.anything(), 'report-numbered.pdf', 'application/pdf')
    expect(toast()?.text).toBe('Exported report-numbered.pdf')
  })

  it('a watermark gets its own file name', async () => {
    await exportStamped({ watermark: { text: 'DRAFT', angle: 45, opacity: 0.2 } })
    expect(download.mock.calls[0][1]).toBe('report-watermarked.pdf')
  })

  it('leaves the pages on the desk exactly as they were', async () => {
    const before = useStore.getState().pages
    await exportStamped({ watermark: { text: 'DRAFT', angle: 45, opacity: 0.2 } })
    expect(useStore.getState().pages).toBe(before)
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('says so if it fails', async () => {
    // An answer the export can't use. (A mock that throws is reported by the test runner even when caught.)
    runJob.mockImplementation(async () => ({ files: [] }))
    await exportStamped({ watermark: { text: 'DRAFT', angle: 45, opacity: 0.2 } })
    expect(toast()).toMatchObject({ tone: 'error' })
    expect(useStore.getState().busy).toBeNull()
  })
})

describe('trimming and resizing', () => {
  beforeEach(() => runJob.mockImplementation(async (_op, _p, name) => ({ files: [{ name, bytes: new Uint8Array(3) }] })))

  it('names the file for what was done', async () => {
    await exportStamped({ layout: { kind: 'trim', margins: { top: 1, right: 1, bottom: 1, left: 1 } } })
    await exportStamped({ layout: { kind: 'fit', paper: 'a4' } })
    expect(download.mock.calls.map((c) => c[1])).toEqual(['report-trimmed.pdf', 'report-resized.pdf'])
  })
})

describe('saving the pictures in the pages', () => {
  const png = (n: number) => ({ png: new Uint8Array([137, 80, n]), width: 10, height: 10 })
  beforeEach(() => {
    useStore.setState({
      sources: {
        a: { id: 'a', name: 'report', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 3 },
        ph: { id: 'ph', name: 'photo', kind: 'image', mime: 'image/jpeg', bytes: new Uint8Array([255, 216, 9]), pageCount: 1, width: 10, height: 10 },
      },
    })
  })

  it('takes every picture from every page, named by page, into one ZIP', async () => {
    pagePictures.mockImplementation(async (_s, index) => (index === 1 ? [] : [png(index * 10), png(index * 10 + 1)]))
    expect(await savePictures()).toEqual({ saved: 4, redactedSkipped: 0 })
    const [bytes, name, type] = download.mock.calls[0]
    expect([name, type]).toEqual(['report-pictures.zip', 'application/zip'])
    expect(Object.keys(unzipSync(bytes))).toEqual(['report-page-01-picture-1.png', 'report-page-01-picture-2.png', 'report-page-03-picture-1.png', 'report-page-03-picture-2.png'])
    expect(toast()?.text).toBe('Saved 4 pictures as report-pictures.zip.')
    expect(useStore.getState().busy).toBeNull()
  })

  it('gives a page included twice, and a picture stored twice, only once', async () => {
    useStore.setState({ pages: [...pagesOf(2), { id: 'again', sourceId: 'a', index: 0, rotation: 0 }] })
    pagePictures.mockImplementation(async (_s, index) => (index === 0 ? [png(1)] : [png(1), png(2)]))
    await savePictures()
    expect(pagePictures).toHaveBeenCalledTimes(2)
    expect(Object.keys(unzipSync(download.mock.calls[0][0]))).toEqual(['report-page-01-picture-1.png', 'report-page-02-picture-1.png'])
  })

  it('gives a photo page its photo as it is, and saves a single picture on its own', async () => {
    useStore.setState({ pages: [{ id: 'x', sourceId: 'ph', index: 0, rotation: 0 }, { id: 'y', sourceId: 'ph', index: 0, rotation: 0 }] })
    await savePictures()
    expect(pagePictures).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith(new Uint8Array([255, 216, 9]), 'photo-page-01-picture-1.jpg', 'image/jpeg')
  })

  it('never reads a page with a redaction box, and says how many were skipped', async () => {
    const box = { kind: 'redact', id: 'r', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    useStore.setState({ pages: pagesOf(3).map((p) => (p.index === 0 ? { ...p, marks: [box] } : p)) as never })
    pagePictures.mockImplementation(async (_s, index) => [png(index)])
    expect(await savePictures()).toEqual({ saved: 2, redactedSkipped: 1 })
    expect(pagePictures.mock.calls.map((c) => c[1])).toEqual([1, 2])
    expect(toast()?.text).toBe('Saved 2 pictures as report-pictures.zip. 1 page with redactions skipped.')
  })

  it('says when there are none, and when the only ones were on redacted pages', async () => {
    pagePictures.mockResolvedValue([])
    expect(await savePictures()).toEqual({ saved: 0, redactedSkipped: 0 })
    expect(download).not.toHaveBeenCalled()
    expect(toast()?.text).toBe('No pictures found in these pages.')
    const box = { kind: 'redact', id: 'r', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    useStore.setState({ pages: [{ id: 'p1', sourceId: 'a', index: 0, rotation: 0, marks: [box] }] as never })
    await savePictures()
    expect(toast()?.text).toBe('No pictures found, apart from pages with redactions, which are skipped.')
  })

  it('says so if a page cannot be read, and saves nothing half-finished', async () => {
    pagePictures.mockImplementation(async (_s, index) => {
      if (index === 1) throw new Error('broken page')
      return [png(index)]
    })
    expect(await savePictures()).toBeNull()
    expect(download).not.toHaveBeenCalled()
    expect(toast()).toMatchObject({ tone: 'error', text: 'Couldn’t save the pictures: broken page' })
    expect(useStore.getState().busy).toBeNull()
  })
})

describe('locking with a password', () => {
  beforeEach(() => runJob.mockImplementation(async (_op, _p, name) => ({ files: [{ name, bytes: new Uint8Array([1, 2]) }] })))

  it('exports the pages, locks them with the options given, and saves the locked file', async () => {
    protectPdf.mockResolvedValue(new Uint8Array([9]))
    const options = { password: 'pw', ownerPassword: 'owner', blockPrinting: true }
    expect(await exportProtected(options)).toBe(true)
    expect(runJob).toHaveBeenCalledWith('merge', useStore.getState().pages, 'report-protected.pdf')
    expect(protectPdf).toHaveBeenCalledWith(new Uint8Array([1, 2]), options)
    expect(download).toHaveBeenCalledWith(new Uint8Array([9]), 'report-protected.pdf', 'application/pdf')
    expect(toast()?.text).toBe('Exported report-protected.pdf, locked with your password')
  })

  it('says so if locking fails, and saves nothing', async () => {
    protectPdf.mockImplementation(async () => {
      throw new Error('engine gone')
    })
    expect(await exportProtected({ password: 'pw' })).toBe(false)
    expect(download).not.toHaveBeenCalled()
    expect(toast()).toMatchObject({ tone: 'error', text: 'Couldn’t lock the file: engine gone' })
  })
})
