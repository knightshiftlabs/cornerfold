import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'

/** One page on the desk. `rotation` is cumulative degrees so animations never spin backwards. */
export interface Page {
  id: string
  sourceId: string
  index: number
  rotation: number
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

  addPages: (sources: Source[], pages: Page[]) => void
  reorder: (activeId: string, overId: string) => void
  rotate: (ids: Set<string>, delta: number) => void
  remove: (ids: Set<string>) => void
  select: (id: string, mode: 'toggle' | 'range') => void
  selectAll: () => void
  deselect: () => void
  undo: () => void
  redo: () => void
  setBusy: (label: string | null) => void
  notify: (text: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void
  dismissToast: () => void
}

const HISTORY_LIMIT = 100
let toastSeq = 0

const keepExisting = (selected: Set<string>, pages: Page[]) => {
  const ids = new Set(pages.map((p) => p.id))
  return new Set([...selected].filter((id) => ids.has(id)))
}

export const useStore = create<State>((set, get) => {
  /** Every edit to the page list goes through here, so every edit is undoable. */
  const commit = (pages: Page[]) =>
    set((s) => ({
      pages,
      past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.pages],
      future: [],
      selected: keepExisting(s.selected, pages),
    }))

  return {
    sources: {},
    pages: [],
    selected: new Set(),
    anchor: null,
    past: [],
    future: [],
    busy: null,
    toast: null,

    addPages: (sources, pages) => {
      set((s) => ({ sources: { ...s.sources, ...Object.fromEntries(sources.map((x) => [x.id, x])) } }))
      commit([...get().pages, ...pages])
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
