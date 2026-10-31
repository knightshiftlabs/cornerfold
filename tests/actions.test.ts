// The buttons' actions, with the export engine replaced by a recorder.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runJob = vi.fn()
vi.mock('../src/lib/engine', () => ({ runJob, getWorker: () => {} }))
vi.mock('../src/lib/ingest', () => ({ ingestFiles: vi.fn() }))

let actions: typeof import('../src/lib/actions')
let useStore: typeof import('../src/lib/store').useStore

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).navigator ??= { platform: 'Win32', userAgent: '' }
  actions = await import('../src/lib/actions')
  ;({ useStore } = await import('../src/lib/store'))
})
beforeEach(() => {
  runJob.mockReset()
  useStore.setState({ sources: {}, pages: [], selected: new Set(), past: [], future: [], toast: null, busy: null })
})

const addPages = () =>
  useStore.getState().addPages(
    [{ id: 'a', name: 'report', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 2 }],
    [
      { id: 'p1', sourceId: 'a', index: 0, rotation: 0 },
      { id: 'p2', sourceId: 'a', index: 1, rotation: 0 },
    ],
  )

describe('empty inputs', () => {
  it('export and split do nothing when there are no pages', async () => {
    await actions.exportPdf()
    await actions.splitPages()
    expect(runJob).not.toHaveBeenCalled()
  })
  it('delete does nothing with an empty selection', () => {
    addPages()
    actions.deleteSelected()
    expect(useStore.getState().pages).toHaveLength(2)
    expect(useStore.getState().toast).toBeNull()
  })
})

describe('what gets exported', () => {
  it('exports only the selected pages when some are selected', async () => {
    addPages()
    useStore.getState().select('p2', 'toggle')
    runJob.mockRejectedValueOnce(new Error('stop here')) // we only care what was asked for
    await actions.exportPdf()
    expect(runJob.mock.calls[0][1].map((p: { id: string }) => p.id)).toEqual(['p2'])
    expect(runJob.mock.calls[0][2]).toBe('report-edited.pdf')
  })

  it('treats splitting a single page as a plain export', async () => {
    addPages()
    useStore.getState().select('p1', 'toggle')
    runJob.mockRejectedValueOnce(new Error('stop'))
    await actions.splitPages()
    expect(runJob.mock.calls[0][0]).toBe('merge')
  })

  it('refuses to start a second export while one is running', async () => {
    addPages()
    useStore.getState().setBusy('Exporting')
    await actions.exportPdf()
    expect(runJob).not.toHaveBeenCalled()
  })
})

describe('failures', () => {
  it('turns the PDF engine’s parser errors into plain language', async () => {
    addPages()
    runJob.mockRejectedValueOnce(new Error('Failed to parse PDF document (line:80 col:204 offset=929): invalid object ref'))
    await actions.exportPdf()
    expect(useStore.getState().toast?.text).toBe('Export failed: one of the files is damaged in a way Cornerfold can’t repair.')
    expect(useStore.getState().busy).toBeNull() // never stuck in a busy state
  })
})
