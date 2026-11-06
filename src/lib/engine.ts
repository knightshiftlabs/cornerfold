import { useStore, type Page } from './store'
import type { UnlockResult } from './unlock'

type OutFile = { name: string; bytes: Uint8Array }
export type JobResult = { files: OutFile[]; stats?: { original: number; size: number; met: boolean }; unlock?: UnlockResult }
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
    const { id, ok, files, stats, unlock, error } = e.data
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (ok) w.resolve({ files, stats, unlock })
    else w.reject(new Error(error))
  }
  worker.onerror = () => {
    for (const w of waiting.values()) w.reject(new Error('Cornerfold’s PDF engine stopped. Reload the page and try again.'))
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
    try {
      w.postMessage(
        { id, op, name, options, pages: pages.map(({ sourceId, index, rotation }) => ({ sourceId, index, rotation })), sources: payload },
        payload.map((s) => s.bytes.buffer),
      )
    } catch (e) {
      // The browser couldn't send it (for example, out of memory). The engine never got these files, so the next
      // job must send them again, and nothing may be left waiting for an answer that will never come.
      waiting.delete(id)
      for (const s of payload) sent.delete(s.id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** Opens a protected PDF with a password ('' to test whether none is needed). The bytes are copied, not moved. */
export function unlockInWorker(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  const w = getWorker()
  const id = ++seq
  const copy = bytes.slice()
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: (r) => resolve(r.unlock!), reject })
    try {
      w.postMessage({ id, op: 'unlock', password, bytes: copy }, [copy.buffer])
    } catch (e) {
      waiting.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** Tell the export engine to drop files the app no longer needs. */
export function forgetSources(ids: string[]) {
  const known = ids.filter((id) => sent.has(id))
  if (!known.length || !worker) return
  for (const id of known) sent.delete(id)
  worker.postMessage({ op: 'forget', ids: known })
}
