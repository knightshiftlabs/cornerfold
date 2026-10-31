import { useStore, type Page } from './store'

type OutFile = { name: string; bytes: Uint8Array }
type Waiter = { resolve: (files: OutFile[]) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let seq = 0
const sent = new Set<string>() // sources the worker already holds; bytes cross the boundary once
const waiting = new Map<number, Waiter>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, ok, files, error } = e.data
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (ok) w.resolve(files)
    else w.reject(new Error(error))
  }
  worker.onerror = () => {
    for (const w of waiting.values()) w.reject(new Error('The PDF engine crashed. Try again.'))
    waiting.clear()
    sent.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function runJob(op: 'merge' | 'split', pages: Page[], name: string): Promise<OutFile[]> {
  const w = getWorker()
  const { sources } = useStore.getState()
  const id = ++seq
  const fresh = [...new Set(pages.map((p) => p.sourceId))].filter((sid) => !sent.has(sid))
  const payload = fresh.map((sid) => {
    const s = sources[sid]
    sent.add(sid)
    return { id: s.id, kind: s.kind, mime: s.mime, width: s.width, height: s.height, bytes: s.bytes.slice() }
  })
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage(
      { id, op, name, pages: pages.map(({ sourceId, index, rotation }) => ({ sourceId, index, rotation })), sources: payload },
      payload.map((s) => s.bytes.buffer),
    )
  })
}
