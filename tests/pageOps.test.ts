// Editing the list of pages: selecting, duplicating, reversing, inserting. Every edit must be undoable.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore, type Page, type Source } from '../src/lib/store'

const source: Source = { id: 'a', name: 'a.pdf', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 6 }
const pagesOf = (n: number): Page[] => Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, sourceId: 'a', index, rotation: 0 }))
const order = () => useStore.getState().pages.map((p) => p.index + 1)
const ids = (...names: string[]) => new Set(names)
const selected = () => [...useStore.getState().selected].sort()

beforeEach(() => useStore.setState({ sources: { a: source }, pages: pagesOf(6), selected: new Set(), anchor: null, past: [], future: [] }))

describe('selecting', () => {
  it('selects exactly the pages asked for, replacing what was selected', () => {
    useStore.getState().selectOnly(['p1'])
    useStore.getState().selectOnly(['p2', 'p4'])
    expect(selected()).toEqual(['p2', 'p4'])
  })

  it('inverts the selection', () => {
    useStore.getState().selectOnly(['p1', 'p2'])
    useStore.getState().invertSelection()
    expect(selected()).toEqual(['p3', 'p4', 'p5', 'p6'])
  })

  it('inverting nothing selects everything', () => {
    useStore.getState().invertSelection()
    expect(selected()).toHaveLength(6)
  })
})

describe('duplicating', () => {
  it('puts a copy straight after each chosen page, with an id of its own', () => {
    useStore.getState().duplicate(ids('p2', 'p5'))
    expect(order()).toEqual([1, 2, 2, 3, 4, 5, 5, 6])
    expect(new Set(useStore.getState().pages.map((p) => p.id)).size).toBe(8)
  })

  it('keeps a copy’s rotation', () => {
    useStore.getState().rotate(ids('p3'), 90)
    useStore.getState().duplicate(ids('p3'))
    expect(useStore.getState().pages.filter((p) => p.index === 2).map((p) => p.rotation)).toEqual([90, 90])
  })

  it('does nothing, and adds no undo step, when no page is chosen', () => {
    useStore.getState().duplicate(new Set())
    expect(order()).toEqual([1, 2, 3, 4, 5, 6])
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('can be undone', () => {
    useStore.getState().duplicate(ids('p1'))
    useStore.getState().undo()
    expect(order()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('reversing', () => {
  it('reverses the whole document when nothing, or one page, is chosen', () => {
    useStore.getState().reverse(new Set())
    expect(order()).toEqual([6, 5, 4, 3, 2, 1])
    useStore.getState().reverse(ids('p1'))
    expect(order()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reverses only the chosen pages, leaving the others where they are', () => {
    useStore.getState().reverse(ids('p2', 'p4', 'p5'))
    expect(order()).toEqual([1, 5, 3, 4, 2, 6])
  })

  it('can be undone', () => {
    useStore.getState().reverse(new Set())
    useStore.getState().undo()
    expect(order()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('inserting', () => {
  const blank: Source = { id: 'b', name: 'Blank page', kind: 'pdf', bytes: new Uint8Array(1), pageCount: 1 }
  const blankPage: Page = { id: 'blank', sourceId: 'b', index: 99, rotation: 0 }

  it('inserts straight after the given page', () => {
    useStore.getState().insertAfter('p2', [blank], [blankPage])
    expect(order()).toEqual([1, 2, 100, 3, 4, 5, 6])
    expect(useStore.getState().sources.b.name).toBe('Blank page')
  })

  it('inserts at the end when no page is given, or the page is gone', () => {
    useStore.getState().insertAfter(null, [blank], [blankPage])
    expect(order()).toEqual([1, 2, 3, 4, 5, 6, 100])
    useStore.getState().undo()
    useStore.getState().insertAfter('missing', [blank], [{ ...blankPage, id: 'blank2' }])
    expect(order()).toEqual([1, 2, 3, 4, 5, 6, 100])
  })

  it('can be undone, and the unused file is then let go', () => {
    useStore.getState().insertAfter('p1', [blank], [blankPage])
    useStore.getState().undo()
    expect(order()).toEqual([1, 2, 3, 4, 5, 6])
    useStore.getState().remove(ids('p6')) // a new edit discards the redo step that still needed the blank page
    expect(useStore.getState().sources.b).toBeUndefined()
  })
})
