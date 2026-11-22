// Saving pages as images or text, and exporting with page numbers or a watermark.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'

const runJob = vi.fn()
const download = vi.fn()
const renderPageImage = vi.fn()
const pageText = vi.fn()
vi.mock('../src/lib/engine', () => ({ runJob: (...a: unknown[]) => runJob(...a), getWorker: () => {} }))
vi.mock('../src/lib/pdf', () => ({ renderPageImage: (...a: unknown[]) => renderPageImage(...a), pageText: (...a: unknown[]) => pageText(...a), openPdf: vi.fn(), getThumb: vi.fn(), EngineError: class extends Error {}, releaseSource: () => {} }))
vi.mock('../src/lib/actions', async (original) => ({ ...(await original<typeof import('../src/lib/actions')>()), download: (...a: unknown[]) => download(...a) }))
;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })

const { collectText, exportStamped, saveImages } = await import('../src/lib/exporters')
const { useStore } = await import('../src/lib/store')

const pagesOf = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, sourceId: 'a', index, rotation: index === 1 ? 90 : 0 }))
const toast = () => useStore.getState().toast

beforeEach(() => {
  for (const f of [runJob, download, renderPageImage, pageText]) f.mockReset()
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
