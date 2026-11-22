import { useStore, type Page } from './store'
import type { UnlockResult } from './unlock'

type OutFile = { name: string; bytes: Uint8Array }
export type JobResult = { files: OutFile[]; stats?: { original: number; size: number; met: boolean }; unlock?: UnlockResult; info?: { parts: number; oversize: number } }
import type { Stamps } from './stampText'
export type JobOptions = { preset?: 'light' | 'balanced' | 'smallest'; target?: number; groups?: number[][]; maxBytes?: number; stamps?: Stamps }
type Waiter = { resolve: (r: JobResult) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let seq = 0
const sent = new Set<string>() // sources the worker already holds; bytes cross the boundary once
const waiting = new Map<number, Waiter>()

export function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, ok, files, stats, info, unlock, error } = e.data
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (ok) w.resolve({ files, stats, info, unlock })
    else w.reject(new Error(error))
  }
  // A crash, or a message the engine could not read, ends every job that is waiting, and the next job starts a fresh engine.
  const stop = () => {
    for (const w of waiting.values()) w.reject(new Error('Cornerfold’s PDF engine stopped. Reload the page and try again.'))
    waiting.clear()
    sent.clear()
    worker?.terminate()
    worker = null
  }
  worker.onerror = stop
  worker.onmessageerror = stop
  return worker
}

/**
 * What a job needs beyond its pages: the paper for photos, the form answers for its files, and the signatures
 * its pages use. Sent with every job, so a changed answer can never meet a copy made before the change.
 */
function recipeFor(pages: Page[]) {
  const st = useStore.getState()
  const files = new Set(pages.map((p) => p.sourceId))
  const fields = Object.fromEntries(Object.entries(st.fieldValues).filter(([sid]) => files.has(sid)))
  const used = new Set(pages.flatMap((p) => p.marks ?? []).flatMap((m) => (m.kind === 'image' ? [m.imageId] : [])))
  const images = [...used].flatMap((id) => (st.markImages[id] ? [{ ...st.markImages[id], png: st.markImages[id].png.slice() }] : []))
  return { paper: st.paper, ...(Object.keys(fields).length ? { fields } : {}), ...(st.lockAnswers ? { flatten: true } : {}), ...(images.length ? { images } : {}) }
}

export function runJob(op: 'merge' | 'split' | 'compress' | 'blank' | 'stamp', pages: Page[], name: string, options?: JobOptions): Promise<JobResult> {
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
        { id, op, name, options: { ...options, ...recipeFor(pages) }, pages: pages.map(({ sourceId, index, rotation, marks }) => ({ sourceId, index, rotation, ...(marks?.length ? { marks } : {}) })), sources: payload },
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
