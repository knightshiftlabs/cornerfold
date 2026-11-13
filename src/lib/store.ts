import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import { DEFAULT_PAPER, type Paper } from './paper'
import type { FieldValue, Mark, MarkImage } from './marks'

/** One page on the desk. `rotation` is cumulative degrees so animations never spin backwards. */
export interface Page {
  id: string
  sourceId: string
  index: number
  rotation: number
  /** Fill and sign: text, signatures, ticks and crosses added to this page. */
  marks?: Mark[]
}

/** A file the user added. Bytes live only in memory, in this tab. */
export interface Source {
  id: string
  name: string
  kind: 'pdf' | 'image'
  bytes: Uint8Array
  pageCount: number
  mime?: 'image/png' | 'image/jpeg'
  width?: number
  height?: number
}

/** The tools that open a panel of their own. */
export type Tool = 'select' | 'split' | 'paper' | 'preview' | 'images' | 'text' | 'numbers' | 'watermark' | 'sign'

export const newId = () => crypto.randomUUID()

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
  action?: { label: string; run: () => void }
}

interface State {
  sources: Record<string, Source>
  pages: Page[]
  selected: Set<string>
  anchor: string | null
  past: Page[][]
  future: Page[][]
  busy: string | null
  toast: Toast | null
  compressOpen: boolean
  setCompressOpen: (open: boolean) => void
  tool: Tool | null
  openTool: (tool: Tool) => void
  closeTool: () => void
  /** The page shown large, while the preview is open. */
  previewPage: string | null
  openPreview: (pageId: string) => void
  /** How photos become pages when exporting. */
  paper: Paper
  setPaper: (paper: Paper) => void
  /** Fill and sign: form answers, by file and then by the field's full name. Kept only in this tab. */
  fieldValues: Record<string, Record<string, FieldValue>>
  setField: (sourceId: string, name: string, value: FieldValue) => void
  /** Fill and sign: signatures and other pictures used by marks. Kept only in this tab. */
  markImages: Record<string, MarkImage>
  addMarkImage: (image: MarkImage) => void
  /** Fill and sign: turn form answers into plain page content when exporting. */
  lockAnswers: boolean
  setLockAnswers: (lock: boolean) => void
  /** Replaces one page's marks, as one undoable step. */
  setMarks: (pageId: string, marks: Mark[]) => void

  addPages: (sources: Source[], pages: Page[]) => void
  /** Adds pages right after the given page, or at the end. */
  insertAfter: (afterId: string | null, sources: Source[], pages: Page[]) => void
  /** Puts a copy of each of these pages straight after it. */
  duplicate: (ids: Set<string>) => void
  /** Reverses these pages among themselves, or the whole document when fewer than two are given. */
  reverse: (ids: Set<string>) => void
  reorder: (activeId: string, overId: string) => void
  rotate: (ids: Set<string>, delta: number) => void
  remove: (ids: Set<string>) => void
  select: (id: string, mode: 'toggle' | 'range') => void
  selectAll: () => void
  selectOnly: (ids: string[]) => void
  invertSelection: () => void
  deselect: () => void
  undo: () => void
  redo: () => void
  setBusy: (label: string | null) => void
  notify: (text: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void
  dismissToast: () => void
}

const HISTORY_LIMIT = 100
let toastSeq = 0

// Set by the app so the store can free memory without importing the PDF engine.
let releaseHandler: (ids: string[]) => void = () => {}
export const onRelease = (fn: (ids: string[]) => void) => (releaseHandler = fn)

const keepExisting = (selected: Set<string>, pages: Page[]) => {
  const ids = new Set(pages.map((p) => p.id))
  return new Set([...selected].filter((id) => ids.has(id)))
}

export const useStore = create<State>((set, get) => {
  /** Every edit to the page list goes through here, so every edit is undoable. */
  const commit = (pages: Page[]) => {
    set((s) => ({
      pages,
      past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.pages],
      future: [],
      selected: keepExisting(s.selected, pages),
    }))
    collect()
  }

  /** Drop files that neither the page list nor any undo or redo step uses, and free their memory. */
  const collect = () => {
    const s = get()
    const used = new Set<string>()
    for (const list of [s.pages, ...s.past, ...s.future]) for (const p of list) used.add(p.sourceId)
    const unused = Object.keys(s.sources).filter((id) => !used.has(id))
    if (!unused.length) return
    const sources = { ...s.sources }
    for (const id of unused) delete sources[id]
    set({ sources })
    releaseHandler(unused)
  }

  return {
    sources: {},
    pages: [],
    selected: new Set(),
    anchor: null,
    past: [],
    future: [],
    busy: null,
    toast: null,
    compressOpen: false,
    setCompressOpen: (compressOpen) => set({ compressOpen }),
    tool: null,
    openTool: (tool) => set({ tool }),
    closeTool: () => set({ tool: null, previewPage: null }),
    previewPage: null,
    openPreview: (pageId) => set({ tool: 'preview', previewPage: pageId }),
    paper: DEFAULT_PAPER,
    setPaper: (paper) => set({ paper }),
    fieldValues: {},
    setField: (sourceId, name, value) => set((s) => ({ fieldValues: { ...s.fieldValues, [sourceId]: { ...s.fieldValues[sourceId], [name]: value } } })),
    markImages: {},
    addMarkImage: (image) => set((s) => ({ markImages: { ...s.markImages, [image.id]: image } })),
    lockAnswers: false,
    setLockAnswers: (lockAnswers) => set({ lockAnswers }),
    setMarks: (pageId, marks) => commit(get().pages.map((p) => (p.id === pageId ? { ...p, marks } : p))),

    addPages: (sources, pages) => {
      set((s) => ({ sources: { ...s.sources, ...Object.fromEntries(sources.map((x) => [x.id, x])) } }))
      commit([...get().pages, ...pages])
    },

    insertAfter: (afterId, sources, pages) => {
      set((s) => ({ sources: { ...s.sources, ...Object.fromEntries(sources.map((x) => [x.id, x])) } }))
      const list = get().pages
      const at = afterId ? list.findIndex((p) => p.id === afterId) + 1 : list.length
      commit([...list.slice(0, at || list.length), ...pages, ...list.slice(at || list.length)])
    },

    duplicate: (ids) => {
      if (!ids.size) return
      commit(get().pages.flatMap((p) => (ids.has(p.id) ? [p, { ...p, id: newId() }] : [p])))
    },

    reverse: (ids) => {
      const pages = get().pages
      if (ids.size < 2) return commit([...pages].reverse())
      const slots = pages.flatMap((p, i) => (ids.has(p.id) ? [i] : []))
      const out = [...pages]
      slots.forEach((slot, k) => (out[slot] = pages[slots[slots.length - 1 - k]]))
      commit(out)
    },

    reorder: (activeId, overId) => {
      const pages = get().pages
      const from = pages.findIndex((p) => p.id === activeId)
      const to = pages.findIndex((p) => p.id === overId)
      if (from < 0 || to < 0 || from === to) return
      commit(arrayMove(pages, from, to))
    },

    rotate: (ids, delta) =>
      commit(get().pages.map((p) => (ids.has(p.id) ? { ...p, rotation: p.rotation + delta } : p))),

    remove: (ids) => commit(get().pages.filter((p) => !ids.has(p.id))),

    select: (id, mode) =>
      set((s) => {
        const selected = new Set(s.selected)
        if (mode === 'range' && s.anchor) {
          const ids = s.pages.map((p) => p.id)
          const a = ids.indexOf(s.anchor)
          const b = ids.indexOf(id)
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(ids[i])
            return { selected }
          }
        }
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        return { selected, anchor: id }
      }),

    selectAll: () => set((s) => ({ selected: new Set(s.pages.map((p) => p.id)) })),
    selectOnly: (ids) => set({ selected: new Set(ids), anchor: ids[ids.length - 1] ?? null }),
    invertSelection: () => set((s) => ({ selected: new Set(s.pages.filter((p) => !s.selected.has(p.id)).map((p) => p.id)), anchor: null })),
    deselect: () => set({ selected: new Set(), anchor: null }),

    undo: () =>
      set((s) => {
        if (!s.past.length) return {}
        const prev = s.past[s.past.length - 1]
        return { pages: prev, past: s.past.slice(0, -1), future: [s.pages, ...s.future], selected: keepExisting(s.selected, prev) }
      }),

    redo: () =>
      set((s) => {
        if (!s.future.length) return {}
        const [next, ...rest] = s.future
        return { pages: next, past: [...s.past, s.pages], future: rest, selected: keepExisting(s.selected, next) }
      }),

    setBusy: (busy) => set({ busy }),
    notify: (text, opts) => set({ toast: { id: ++toastSeq, text, tone: opts?.tone ?? 'ok', action: opts?.action } }),
    dismissToast: () => set({ toast: null }),
  }
})
