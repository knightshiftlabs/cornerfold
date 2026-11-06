// The messages between the page and the PDF engine, including when the browser can't deliver one.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Message = { id: number; sources: { id: string }[] }
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  sent: Message[] = []
  failNext = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(message: Message) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('out of memory')
    }
    this.sent.push(message)
  }
  terminate() {}
}

let engine: typeof import('../src/lib/engine')
const page = { id: 'p1', sourceId: 'a', index: 0, rotation: 0 }
const worker = () => engine.getWorker() as unknown as FakeWorker
const answer = (message: Message) => worker().onmessage?.({ data: { id: message.id, ok: true, files: [] } })

beforeEach(async () => {
  vi.resetModules() // a fresh engine each time, remembering nothing about earlier tests
  FakeWorker.all = []
  vi.stubGlobal('Worker', FakeWorker)
  engine = await import('../src/lib/engine')
  const { useStore } = await import('../src/lib/store')
  useStore.setState({ sources: { a: { id: 'a', name: 'a', kind: 'pdf', bytes: new Uint8Array(10), pageCount: 1 } }, pages: [page] })
})

describe('sending a job to the PDF engine', () => {
  it('sends each file once, however many jobs use it', async () => {
    const first = engine.runJob('merge', [page], 'out')
    answer(worker().sent[0])
    await first
    const second = engine.runJob('merge', [page], 'out')
    answer(worker().sent[1])
    await second
    expect(worker().sent.map((m) => m.sources.length)).toEqual([1, 0])
  })

  it('when the browser can’t send it: says so, and sends the files again next time, since the engine never got them (regression)', async () => {
    worker().failNext = true
    await expect(engine.runJob('merge', [page], 'out')).rejects.toThrow('out of memory')
    expect(worker().sent).toHaveLength(0)

    const retry = engine.runJob('merge', [page], 'out')
    expect(worker().sent[0].sources.map((s) => s.id)).toEqual(['a']) // before the fix this was empty, and the job failed
    answer(worker().sent[0])
    await expect(retry).resolves.toMatchObject({ files: [] })
  })

  it('a password check that can’t be sent fails cleanly too', async () => {
    worker().failNext = true
    await expect(engine.unlockInWorker(new Uint8Array(4), 'secret')).rejects.toThrow('out of memory')
  })
})
