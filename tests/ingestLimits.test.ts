// Adding many files at once: how many are read together, and in what order they land.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const delays = new Map<string, number>()
let active = 0
let peak = 0
vi.mock('../src/lib/pdf', () => ({
  EngineError: class extends Error {},
  openPdf: async (_id: string, bytes: Uint8Array) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, delays.get(String.fromCharCode(bytes[0])) ?? 10))
    active--
    return { numPages: 1 }
  },
  releaseSource: () => {},
}))
vi.mock('../src/lib/engine', () => ({ getWorker: () => {}, runJob: vi.fn(), unlockInWorker: vi.fn() }))

let ingestFiles: typeof import('../src/lib/ingest').ingestFiles
let useStore: typeof import('../src/lib/store').useStore
// A "PDF" whose first byte tells the stand-in reader how long to take. Only its size and first byte matter here.
const file = (name: string, tag: string) => new File([new Uint8Array([tag.charCodeAt(0), 1, 2, 3])], `${name}.pdf`, { type: 'application/pdf' })
const names = () => useStore.getState().pages.map((p) => useStore.getState().sources[p.sourceId].name)

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })
  ;({ ingestFiles } = await import('../src/lib/ingest'))
  ;({ useStore } = await import('../src/lib/store'))
})
beforeEach(() => {
  useStore.setState({ sources: {}, pages: [], past: [], future: [], toast: null, busy: null })
  delays.clear()
  active = peak = 0
})

describe('adding many files at once', () => {
  it('reads only a few at a time, not all together (regression: every file was held in memory at once)', async () => {
    await ingestFiles(Array.from({ length: 12 }, (_, i) => file(`f${i + 1}`, 'x')))
    expect(useStore.getState().pages).toHaveLength(12)
    expect(peak).toBe(3) // still in parallel, but never more than three
  })

  it('puts the pages in the order the files were given, even when a later file is read first', async () => {
    delays.set('s', 60) // the first file is the slowest
    await ingestFiles([file('slow', 's'), ...Array.from({ length: 6 }, (_, i) => file(`quick${i + 1}`, 'q'))])
    expect(names()).toEqual(['slow', 'quick1', 'quick2', 'quick3', 'quick4', 'quick5', 'quick6'])
  })

  it('a single file, or none that can be used, still works', async () => {
    await ingestFiles([file('one', 'x')])
    expect(names()).toEqual(['one'])
    await ingestFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })])
    expect(names()).toEqual(['one'])
  })
})
