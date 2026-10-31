import { useStore, type Page } from './store'

type OutFile = { name: string; bytes: Uint8Array }
export type JobResult = { files: OutFile[]; stats?: { original: number; size: number; met: boolean } }
export type JobOptions = { preset?: 'light' | 'balanced' | 'smallest'; target?: number }
type Waiter = { resolve: (r: JobResult) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let seq = 0
const sent = new Set<string>() // sources the worker already holds; bytes cross the boundary once
const waiting = new Map<number, Waiter>()

export function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, ok, files, stats, error } = e.data
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (ok) w.resolve({ files, stats })
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

export function runJob(op: 'merge' | 'split' | 'compress', pages: Page[], name: string, options?: JobOptions): Promise<JobResult> {
  const w = getWorker()
  const { sources } = useStore.getState()
  const id = ++seq
  const fresh = [...new Set(pages.map((p) => p.sourceId))].filter((sid) => !sent.has(sid))
  const payload = fresh.map((sid) => {
    const s = sources[sid]
    sent.add(sid)
    return { id: s.id, kind: s.kind, pageCount: s.pageCount, mime: s.mime, width: s.width, height: s.height, bytes: s.bytes.slice() }
  })
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage(
      { id, op, name, options, pages: pages.map(({ sourceId, index, rotation }) => ({ sourceId, index, rotation })), sources: payload },
      payload.map((s) => s.bytes.buffer),
    )
  })
}
