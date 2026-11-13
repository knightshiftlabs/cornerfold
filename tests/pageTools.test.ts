// The quick page tools: what they ask the PDF engine for, and what they tell the person.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runJob = vi.fn()
const download = vi.fn()
const openPdf = vi.fn(async () => ({ numPages: 1 }))
vi.mock('../src/lib/engine', () => ({ runJob: (...a: unknown[]) => runJob(...a), getWorker: () => {} }))
vi.mock('../src/lib/pdf', () => ({ openPdf: (...a: unknown[]) => openPdf(...(a as [])), getThumb: vi.fn(), EngineError: class extends Error {}, releaseSource: () => {} }))
vi.mock('../src/lib/actions', async (original) => ({ ...(await original<typeof import('../src/lib/actions')>()), download: (...a: unknown[]) => download(...a) }))
;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })

const { chunks, duplicateSelected, insertBlankPage, reverseOrder, selectIndices, splitBy } = await import('../src/lib/pageTools')
const { useStore } = await import('../src/lib/store')

const pagesOf = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, sourceId: 'a', index, rotation: 0 }))
const toast = () => useStore.getState().toast
const order = () => useStore.getState().pages.map((p) => `${p.sourceId}${p.index + 1}`)

beforeEach(() => {
  runJob.mockReset()
  download.mockReset()
  openPdf.mockClear()
  useStore.setState({ sources: { a: { id: 'a', name: 'report', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 7 } }, pages: pagesOf(7), selected: new Set(), anchor: null, past: [], future: [], toast: null, busy: null })
})

describe('grouping pages', () => {
  it('makes groups of the size asked for, the last one shorter when the pages don’t divide evenly', () => {
    expect(chunks(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]])
    expect(chunks(4, 2)).toEqual([[0, 1], [2, 3]])
    expect(chunks(3, 10)).toEqual([[0, 1, 2]])
    expect(chunks(3, 0)).toEqual([[0], [1], [2]]) // never an endless loop
  })
})

describe('selecting by position', () => {
  it('selects those pages, replacing the selection, and says how many', () => {
    useStore.getState().selectOnly(['p7'])
    selectIndices([0, 2])
    expect([...useStore.getState().selected]).toEqual(['p1', 'p3'])
    expect(toast()?.text).toBe('2 pages selected')
  })

  it('ignores positions that don’t exist', () => {
    selectIndices([0, 99])
    expect([...useStore.getState().selected]).toEqual(['p1'])
    expect(toast()?.text).toBe('1 page selected')
  })
})

describe('duplicating and reversing', () => {
  it('asks for a selection before duplicating', () => {
    duplicateSelected()
    expect(useStore.getState().pages).toHaveLength(7)
    expect(toast()).toMatchObject({ tone: 'error', text: 'Select the pages to duplicate first.' })
  })

  it('duplicates the selection and says so', () => {
    useStore.getState().selectOnly(['p2'])
    duplicateSelected()
    expect(order()).toEqual(['a1', 'a2', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
    expect(toast()?.text).toBe('Duplicated 1 page')
  })

  it('reverses everything, or just the selection, and says which', () => {
    reverseOrder()
    expect(order()[0]).toBe('a7')
    expect(toast()?.text).toBe('Reversed the page order')
    useStore.getState().selectOnly(['p1', 'p2'])
    reverseOrder()
    expect(toast()?.text).toBe('Reversed the 2 selected pages')
  })
})

describe('inserting a blank page', () => {
  beforeEach(() => runJob.mockResolvedValue({ files: [{ name: 'Blank page', bytes: new Uint8Array([1, 2, 3]) }] }))

  it('goes after the last selected page, sized like it', async () => {
    useStore.getState().selectOnly(['p2', 'p4'])
    await insertBlankPage()
    expect(runJob.mock.calls[0].slice(0, 2)).toEqual(['blank', [expect.objectContaining({ id: 'p4' })]])
    expect(useStore.getState().pages.map((p) => p.sourceId === 'a')).toEqual([true, true, true, true, false, true, true, true])
    expect(toast()?.text).toBe('Blank page added after the selection')
  })

  it('goes at the end, sized like the last page, when nothing is selected', async () => {
    await insertBlankPage()
    expect(runJob.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 'p7' })])
    expect(useStore.getState().pages[7].sourceId).not.toBe('a')
    expect(Object.values(useStore.getState().sources).find((s) => s.id !== 'a')).toMatchObject({ name: 'Blank page', kind: 'pdf', pageCount: 1 })
    expect(openPdf).toHaveBeenCalledTimes(1) // so its thumbnail can be drawn
  })

  it('is one undoable step', async () => {
    await insertBlankPage()
    useStore.getState().undo()
    expect(useStore.getState().pages).toHaveLength(7)
  })

  it('says so if it fails, and leaves the document alone', async () => {
    runJob.mockResolvedValue({ files: [] }) // the engine answered, but with no page
    await insertBlankPage()
    expect(useStore.getState().pages).toHaveLength(7)
    expect(toast()).toMatchObject({ tone: 'error' })
    expect(useStore.getState().busy).toBeNull()
  })
})

describe('splitting', () => {
  const zip = { files: [{ name: 'report-parts.zip', bytes: new Uint8Array(4) }], info: { parts: 3, oversize: 0 } }

  it('by ranges: sends the groups as typed, over the whole document', async () => {
    runJob.mockResolvedValue(zip)
    await splitBy({ groups: [[0, 1], [4]] })
    expect(runJob).toHaveBeenCalledWith('split', useStore.getState().pages, 'report', { groups: [[0, 1], [4]] })
    expect(download).toHaveBeenCalledWith(zip.files[0].bytes, 'report-parts.zip', 'application/zip')
    expect(toast()?.text).toBe('Split into 3 PDFs.')
  })

  it('every N pages: works the groups out itself', async () => {
    runJob.mockResolvedValue(zip)
    await splitBy({ every: 3 })
    expect(runJob.mock.calls[0][3]).toEqual({ groups: [[0, 1, 2], [3, 4, 5], [6]] })
  })

  it('by size: passes the limit, and reports pages that are too big on their own', async () => {
    runJob.mockResolvedValue({ ...zip, info: { parts: 5, oversize: 2 } })
    await splitBy({ maxBytes: 5_000_000 })
    expect(runJob.mock.calls[0][3]).toEqual({ maxBytes: 5_000_000 })
    expect(toast()?.text).toBe('Split into 5 PDFs. 2 pages are larger than the limit on their own.')
  })

  it('a single part is saved as a plain PDF, not a ZIP holding one file', async () => {
    runJob.mockResolvedValue({ files: [{ name: 'report-part.pdf', bytes: new Uint8Array(4) }] })
    await splitBy({ groups: [[1, 2, 3]] })
    expect(runJob.mock.calls[0].slice(0, 3)).toEqual(['merge', useStore.getState().pages.slice(1, 4), 'report-part.pdf'])
    expect(download).toHaveBeenCalledWith(expect.anything(), 'report-part.pdf', 'application/pdf')
    expect(toast()?.text).toBe('Saved 3 pages as report-part.pdf')
  })

  it('says so if it fails, and is ready to be tried again', async () => {
    runJob.mockRejectedValue(new Error('boom'))
    await splitBy({ every: 2 })
    expect(toast()).toMatchObject({ tone: 'error' })
    expect(useStore.getState().busy).toBeNull()
    expect(download).not.toHaveBeenCalled()
  })
})
