import { beforeEach, describe, expect, it } from 'vitest'
import { onRelease, useStore, type Page, type Source } from '../src/lib/store'

const src = (id: string): Source => ({ id, name: id, kind: 'pdf', bytes: new Uint8Array(1), pageCount: 1 })
const page = (id: string, sourceId: string): Page => ({ id, sourceId, index: 0, rotation: 0 })
let released: string[] = []

beforeEach(() => {
  useStore.setState({ sources: {}, pages: [], selected: new Set(), anchor: null, past: [], future: [] })
  released = []
  onRelease((ids) => released.push(...ids))
  useStore.getState().addPages([src('a'), src('b')], [page('p1', 'a'), page('p2', 'b'), page('p3', 'b')])
})

describe('editing and undo', () => {
  it('undoes and redoes every kind of edit', () => {
    const s = useStore.getState
    s().rotate(new Set(['p2']), 90)
    s().reorder('p3', 'p1')
    s().remove(new Set(['p1']))
    expect(s().pages.map((p) => p.id)).toEqual(['p3', 'p2'])
    s().undo()
    s().undo()
    expect(s().pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(s().pages[1].rotation).toBe(90)
    s().redo()
    expect(s().pages.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
  })

  it('keeps rotation cumulative so animations never spin backwards', () => {
    for (let i = 0; i < 5; i++) useStore.getState().rotate(new Set(['p1']), 90)
    expect(useStore.getState().pages[0].rotation).toBe(450)
  })

  it('selects ranges with shift-click', () => {
    useStore.getState().select('p1', 'toggle')
    useStore.getState().select('p3', 'range')
    expect([...useStore.getState().selected].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('drops deleted pages from the selection', () => {
    useStore.getState().select('p1', 'toggle')
    useStore.getState().remove(new Set(['p1']))
    expect(useStore.getState().selected.size).toBe(0)
  })
})

describe('freeing memory (regression: deleted files were kept forever)', () => {
  it('keeps a deleted file while it can still be undone', () => {
    useStore.getState().remove(new Set(['p1']))
    expect(released).toEqual([])
    expect(useStore.getState().sources.a).toBeDefined()
  })

  it('releases it once no undo step can bring it back', () => {
    useStore.getState().remove(new Set(['p1']))
    for (let i = 0; i < 101; i++) useStore.getState().rotate(new Set(['p2']), 90)
    expect(released).toEqual(['a'])
    expect(Object.keys(useStore.getState().sources)).toEqual(['b'])
  })

  it('never releases a file that is still on the page', () => {
    for (let i = 0; i < 150; i++) useStore.getState().rotate(new Set(['p1']), 90)
    expect(released).toEqual([])
  })
})
