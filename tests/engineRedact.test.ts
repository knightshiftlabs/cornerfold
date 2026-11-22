// The one place every export passes through: nothing redacted may reach the export engine unflattened.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const posted: { pages: { sourceId: string; marks?: { kind: string }[] }[]; sources: { id: string; kind: string; pointSize?: number[] }[] }[] = []
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  postMessage(m: (typeof posted)[number] & { id: number }) {
    posted.push(m)
    queueMicrotask(() => this.onmessage?.({ data: { id: m.id, ok: true, files: [] } }))
  }
  terminate() {}
}
vi.mock('../src/lib/pdf', () => ({
  pdfPageSize: async () => [595, 842],
  renderRedacted: async () => ({ bytes: new Uint8Array([9]), width: 100, height: 100 }),
}))

let runJob: typeof import('../src/lib/engine').runJob
let useStore: typeof import('../src/lib/store').useStore

beforeEach(async () => {
  vi.resetModules()
  posted.length = 0
  ;(globalThis as Record<string, unknown>).Worker = FakeWorker
  ;(globalThis as Record<string, unknown>).matchMedia = () => ({ matches: false })
  ;({ runJob } = await import('../src/lib/engine'))
  ;({ useStore } = await import('../src/lib/store'))
  useStore.setState({ sources: { s: { id: 's', name: 'f', kind: 'pdf', bytes: new Uint8Array([1]), pageCount: 2 } } })
})

const redacted = { id: 'p1', sourceId: 's', index: 0, rotation: 0, marks: [{ id: 'r', kind: 'redact' as const, x: 0, y: 0, w: 0.5, h: 0.1 }] }
const plain = { id: 'p2', sourceId: 's', index: 1, rotation: 0 }

describe('every kind of export of a redacted page', () => {
  for (const op of ['merge', 'compress', 'split', 'stamp'] as const) {
    it(`${op}: the engine gets a picture with no redaction left, and the original page is not sent for it`, async () => {
      await runJob(op, [redacted, plain], 'out')
      const sent = posted[0]
      expect(sent.pages[0].sourceId).not.toBe('s')
      expect(sent.pages[0].marks ?? []).toHaveLength(0)
      expect(sent.pages[1].sourceId).toBe('s')
      const picture = sent.sources.find((s) => s.id === sent.pages[0].sourceId)!
      expect(picture).toMatchObject({ kind: 'image', pointSize: [595, 842] })
      // The redacted page's own file is sent only because another page of it is exported too.
      expect(sent.sources.map((s) => s.id)).toContain('s')
    })
  }

  it('when only the redacted page is exported, the original file is never sent to the engine at all', async () => {
    await runJob('merge', [redacted], 'out')
    expect(posted[0].sources.map((s) => s.id)).not.toContain('s')
  })

  it('without redactions, nothing is drawn and the pages go through as they are', async () => {
    await runJob('merge', [plain], 'out')
    expect(posted[0].pages[0].sourceId).toBe('s')
  })
})
